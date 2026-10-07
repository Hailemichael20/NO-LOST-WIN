import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { reviewReceipt } from '../lib/receipt-review.js';

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
    const status = request.body?.status || 'approved';
    if (typeof entryId !== 'string' || !entryId) return response.status(400).json({ error: 'A receipt entry ID is required.' });
    if (!['approved', 'rejected'].includes(status)) {
      return response.status(400).json({ error: 'A valid receipt review status is required.' });
    }

    const result = await reviewReceipt(
      getFirestore(app),
      entryId,
      status,
      token.uid,
      { onlyPending: status === 'rejected' },
    );

    return response.status(200).json(result);
  } catch (error) {
    console.error('Receipt approval error:', error);
    return response.status(400).json({ error: error.message || 'Could not approve receipt.' });
  }
}
