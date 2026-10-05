import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
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
      if (existingTransaction.exists) {
        if (entry.status !== 'approved' || entry.walletTransactionId !== walletTransactionRef.id) {
          throw new Error('Receipt wallet state is inconsistent and needs administrator review.');
        }
        return { alreadyProcessed: true, amount };
      }
      if (!['pending', 'rejected'].includes(entry.status)) throw new Error('Only pending or rejected receipts can be approved.');

      let reservationRef;
      let boardRef;
      if (entry.ticketReservationId) {
        if (!/^(50|100|200|500)-[0-9]{3}$/.test(entry.ticketReservationId)
          || entry.ticketReservationId !== `${entry.ticketTier}-${entry.number}`) {
          throw new Error('Receipt ticket details are invalid.');
        }
        reservationRef = db.collection('ticketReservations').doc(entry.ticketReservationId);
        boardRef = db.collection('ticketBoard').doc(entry.ticketReservationId);
        const reservationSnapshot = await transaction.get(reservationRef);
        const boardSnapshot = await transaction.get(boardRef);
        if (!reservationSnapshot.exists || !boardSnapshot.exists) {
          throw new Error('Ticket reservation is no longer available.');
        }

        const reservation = reservationSnapshot.data();
        const board = boardSnapshot.data();
        const expiresAt = reservation.expiresAt?.toMillis();
        if (reservation.ownerUid !== entry.userId
          || reservation.status !== entry.status
          || reservation.entryId !== entryId
          || !Number.isFinite(expiresAt)
          || expiresAt <= Date.now()
          || reservation.tier !== entry.ticketTier
          || reservation.number !== entry.number
          || reservation.expiresAt.toMillis() !== entry.expiresAt?.toMillis()
          || board.ownerUid !== entry.userId
          || board.status !== entry.status
          || board.tier !== entry.ticketTier
          || board.number !== entry.number
          || board.expiresAt?.toMillis() !== expiresAt) {
          throw new Error('The ticket reservation expired before administrator confirmation.');
        }
      }

      const userRef = db.collection('users').doc(entry.userId);
      const userSnapshot = await transaction.get(userRef);
      const currentBalance = Number(userSnapshot.data()?.winBirrBalance || 0);
      if (!Number.isFinite(currentBalance) || currentBalance < 0) throw new Error('User wallet balance is invalid.');

      transaction.set(userRef, { winBirrBalance: currentBalance + amount, walletUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.set(walletTransactionRef, { userId: entry.userId, entryId, type: 'receipt_credit', amount, createdAt: FieldValue.serverTimestamp(), createdBy: token.uid });
      transaction.update(entryRef, { status: 'approved', approvedAt: FieldValue.serverTimestamp(), reviewedAt: FieldValue.serverTimestamp(), approvedBy: token.uid, walletTransactionId: walletTransactionRef.id });
      if (reservationRef && boardRef) {
        transaction.update(reservationRef, { status: 'approved' });
        transaction.update(boardRef, { status: 'approved' });
      }
      return { alreadyProcessed: false, amount };
    });

    return response.status(200).json(result);
  } catch (error) {
    console.error('Receipt approval error:', error);
    return response.status(400).json({ error: error.message || 'Could not approve receipt.' });
  }
}
