import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function getFirebaseAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    throw new Error('Firebase Admin environment variables are not configured.');
  }

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  try {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) return response.status(401).json({ error: 'Authentication required.' });

    const app = getFirebaseAdminApp();
    const token = await getAuth(app).verifyIdToken(authorization.slice(7));
    if (token.admin !== true) return response.status(403).json({ error: 'Administrator access is required.' });

    const entryId = request.body?.entryId;
    if (typeof entryId !== 'string' || !entryId) return response.status(400).json({ error: 'A receipt entry ID is required.' });

    const db = getFirestore(app);
    const entryRef = db.collection('entries').doc(entryId);
    const walletTransactionRef = db.collection('walletTransactions').doc(entryId);
    const result = await db.runTransaction(async (transaction) => {
      const entrySnapshot = await transaction.get(entryRef);
      if (!entrySnapshot.exists) throw new Error('Receipt not found.');

      const entry = entrySnapshot.data();
      const amount = Number(entry.tier);
      if (!entry.userId || ![50, 100, 200, 500].includes(amount)) throw new Error('Receipt has invalid wallet data.');

      const existingTransaction = await transaction.get(walletTransactionRef);
      if (existingTransaction.exists) return { alreadyProcessed: true, amount };
      if (!['pending', 'rejected'].includes(entry.status)) throw new Error('Only pending or rejected receipts can be approved.');

      const userRef = db.collection('users').doc(entry.userId);
      const userSnapshot = await transaction.get(userRef);
      const currentBalance = Number(userSnapshot.data()?.winBirrBalance || 0);
      if (!Number.isFinite(currentBalance) || currentBalance < 0) throw new Error('User wallet balance is invalid.');

      transaction.set(userRef, { winBirrBalance: currentBalance + amount, walletUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(walletTransactionRef, { userId: entry.userId, entryId, type: 'receipt_credit', amount, createdAt: FieldValue.serverTimestamp(), createdBy: token.uid });
      transaction.update(entryRef, { status: 'approved', approvedAt: FieldValue.serverTimestamp(), reviewedAt: FieldValue.serverTimestamp(), approvedBy: token.uid, walletTransactionId: walletTransactionRef.id });
      return { alreadyProcessed: false, amount };
    });

    return response.status(200).json(result);
  } catch (error) {
    console.error('Receipt approval error:', error);
    return response.status(400).json({ error: error.message || 'Could not approve receipt.' });
  }
}
