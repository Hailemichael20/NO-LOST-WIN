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

    if (!VALID_TIERS.includes(tier)
      || !isValidTicketNumber(number)
      || fullName.length < 1
      || fullName.length > 100
      || phone.length < 7
      || phone.length > 32) {
      return response.status(400).json({ error: 'Ticket details are invalid.' });
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

    await db.runTransaction(async (transaction) => {
      const [reservationSnapshot, boardSnapshot, confirmedEntrySnapshot] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(boardRef),
        transaction.get(confirmedEntryQuery),
      ]);
      const isStillHeld = (snapshot) => {
        if (!snapshot.exists) return false;
        const existing = snapshot.data();
        return existing.status === 'approved' || existing.expiresAt?.toMillis() > now;
      };

      if (confirmedEntrySnapshot.size > 0
        || isStillHeld(reservationSnapshot)
        || isStillHeld(boardSnapshot)) {
        const error = new Error('Ticket number is already reserved.');
        error.code = 'TICKET_TAKEN';
        throw error;
      }

      const reservation = {
        ownerUid: user.uid,
        tier: tierCode,
        number: numberCode,
        fullName,
        phone,
        status: 'reserved',
        reservedAt: FieldValue.serverTimestamp(),
        expiresAt,
      };
      transaction.set(reservationRef, reservation);
      transaction.set(boardRef, {
        ownerUid: user.uid,
        tier: tierCode,
        number: numberCode,
        fullName,
        phoneLast4: phone.slice(-4),
        status: 'reserved',
        reservedAt: FieldValue.serverTimestamp(),
        expiresAt,
      });
    });

    return response.status(200).json({
      reservationId: ticketId,
      tier: tierCode,
      number: numberCode,
      expiresAt: expiresAt.toMillis(),
    });
  } catch (error) {
    if (error.code === 'TICKET_TAKEN') {
      return response.status(409).json({ code: error.code, error: error.message });
    }
    console.error('Ticket reservation error:', error);
    return response.status(400).json({ error: 'Could not reserve this ticket number.' });
  }
}
