import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

const TICKET_ID_PATTERN = /^(50|100|200|500)-([0-9]{3})$/;

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  try {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      return response.status(401).json({ error: 'Authentication required.' });
    }

    const app = getFirebaseAdminApp();
    const user = await getAuth(app).verifyIdToken(authorization.slice(7));
    const reservationId = request.body?.reservationId;
    const receiptUrl = request.body?.receiptUrl;
    if (typeof reservationId !== 'string' || !TICKET_ID_PATTERN.test(reservationId)) {
      return response.status(400).json({ error: 'Ticket reservation is invalid.' });
    }
    if (typeof receiptUrl !== 'string' || receiptUrl.length > 2048) {
      return response.status(400).json({ error: 'Receipt image URL is invalid.' });
    }
    let parsedReceiptUrl;
    try {
      parsedReceiptUrl = new URL(receiptUrl);
    } catch {
      return response.status(400).json({ error: 'Receipt image URL is invalid.' });
    }
    if (parsedReceiptUrl.protocol !== 'https:'
      || parsedReceiptUrl.hostname !== 'res.cloudinary.com'
      || !parsedReceiptUrl.pathname.includes('/image/upload/')) {
      return response.status(400).json({ error: 'Receipt must be stored in Cloudinary.' });
    }

    const db = getFirestore(app);
    const reservationRef = db.collection('ticketReservations').doc(reservationId);
    const boardRef = db.collection('ticketBoard').doc(reservationId);
    const entryRef = db.collection('entries').doc();
    const privateEntryRef = db.collection('entryPrivate').doc(entryRef.id);
    const result = await db.runTransaction(async (transaction) => {
      const [reservationSnapshot, boardSnapshot] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(boardRef),
      ]);
      if (!reservationSnapshot.exists || !boardSnapshot.exists) {
        const error = new Error('Ticket reservation expired.');
        error.code = 'RESERVATION_EXPIRED';
        throw error;
      }

      const reservation = reservationSnapshot.data();
      const board = boardSnapshot.data();
      if (reservation.ownerUid !== user.uid
        || reservation.status !== 'reserved'
        || reservation.expiresAt?.toMillis() <= Date.now()
        || board.ownerUid !== user.uid
        || board.status !== 'reserved') {
        const error = new Error('Ticket reservation expired.');
        error.code = 'RESERVATION_EXPIRED';
        throw error;
      }

      const entry = {
        entryId: entryRef.id,
        tier: Number(reservation.tier),
        number: reservation.number,
        ticketReservationId: reservationId,
        phoneLast4: board.phoneLast4,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      };
      transaction.create(entryRef, entry);
      transaction.create(privateEntryRef, {
        userId: user.uid,
        email: user.email || '',
        fullName: reservation.fullName,
        phone: reservation.phone,
        tier: reservation.tier,
        number: reservation.number,
        ticketReservationId: reservationId,
        expiresAt: reservation.expiresAt,
        receiptUrl,
      });
      transaction.update(reservationRef, { status: 'pending', entryId: entryRef.id });
      transaction.update(boardRef, { status: 'pending' });
      return { entryId: entryRef.id };
    });

    return response.status(200).json(result);
  } catch (error) {
    if (error.code === 'RESERVATION_EXPIRED') {
      return response.status(409).json({ code: error.code, error: error.message });
    }
    console.error('Receipt submission error:', error);
    return response.status(400).json({ error: 'Could not submit the receipt.' });
  }
}
