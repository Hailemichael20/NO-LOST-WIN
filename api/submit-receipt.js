import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { isValidTicketNumber, RESERVATION_DURATION_MS } from '../lib/ticket-constants.js';

const VALID_TIERS = [50, 100, 200, 500];

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
    
    const tier = Number(request.body?.tier);
    const number = Number(request.body?.number);
    const fullName = typeof request.body?.fullName === 'string' ? request.body.fullName.trim() : '';
    const phone = typeof request.body?.phone === 'string' ? request.body.phone.trim() : '';
    const receiptUrl = request.body?.receiptUrl;

    if (!VALID_TIERS.includes(tier) || !isValidTicketNumber(number)) {
      return response.status(400).json({ error: 'Ticket details are invalid.' });
    }
    if (fullName.length < 1 || fullName.length > 100 || phone.length < 7 || phone.length > 32) {
      return response.status(400).json({ error: 'Contact details are invalid.' });
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

    const tierCode = String(tier);
    const numberCode = String(number).padStart(3, '0');
    const ticketId = `${tierCode}-${numberCode}`;

    const db = getFirestore(app);
    const reservationRef = db.collection('ticketReservations').doc(ticketId);
    const boardRef = db.collection('ticketBoard').doc(ticketId);
    const confirmedEntryQuery = db.collection('entries')
      .where('tier', '==', tier)
      .where('number', '==', numberCode)
      .where('status', '==', 'approved')
      .limit(1);

    const now = Date.now();
    const expiresAt = Timestamp.fromMillis(now + RESERVATION_DURATION_MS);

    const entryRef = db.collection('entries').doc();
    const privateEntryRef = db.collection('entryPrivate').doc(entryRef.id);

    const result = await db.runTransaction(async (transaction) => {
      const [reservationSnapshot, boardSnapshot, confirmedEntrySnapshot] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(boardRef),
        transaction.get(confirmedEntryQuery),
      ]);

      const isStillHeld = (snapshot) => {
        if (!snapshot.exists) return false;
        const existing = snapshot.data();
        return existing.status === 'approved' 
          || existing.status === 'pending' 
          || (existing.status === 'reserved' && existing.expiresAt?.toMillis() > now);
      };

      if (confirmedEntrySnapshot.size > 0
        || isStillHeld(reservationSnapshot)
        || isStillHeld(boardSnapshot)) {
        const error = new Error('Ticket number is already reserved or taken.');
        error.code = 'TICKET_TAKEN';
        throw error;
      }

      const entry = {
        entryId: entryRef.id,
        tier: Number(tier),
        number: numberCode,
        ticketReservationId: ticketId,
        phoneLast4: phone.slice(-4),
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      };

      const reservation = {
        ownerUid: user.uid,
        tier: tierCode,
        number: numberCode,
        fullName,
        phone,
        status: 'pending',
        entryId: entryRef.id,
        reservedAt: FieldValue.serverTimestamp(),
        expiresAt,
      };

      const boardData = {
        ownerUid: user.uid,
        tier: tierCode,
        number: numberCode,
        fullName,
        phoneLast4: phone.slice(-4),
        status: 'pending',
        reservedAt: FieldValue.serverTimestamp(),
        expiresAt,
      };

      transaction.set(entryRef, entry);
      transaction.set(privateEntryRef, {
        userId: user.uid,
        email: user.email || '',
        fullName,
        phone,
        tier: tierCode,
        number: numberCode,
        ticketReservationId: ticketId,
        expiresAt,
        receiptUrl,
      });
      transaction.set(reservationRef, reservation);
      transaction.set(boardRef, boardData);

      return { entryId: entryRef.id, reservationId: ticketId };
    });

    return response.status(200).json(result);
  } catch (error) {
    if (error.code === 'TICKET_TAKEN') {
      return response.status(409).json({ code: error.code, error: error.message });
    }
    console.error('Receipt submission error:', error);
    return response.status(400).json({ error: 'Could not submit the receipt.' });
  }
}