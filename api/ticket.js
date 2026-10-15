import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { isValidTicketNumber } from '../lib/ticket-constants.js';

const VALID_TIERS = [50, 100, 200, 500];
const SHORT_RESERVATION_MS = 2 * 60 * 1000;
const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24-hour window to keep grid locked and visible

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  const url = request.url || '';

  if (url.includes('reserve-ticket')) {
    return handleReserve(request, response);
  } else if (url.includes('submit-receipt')) {
    return handleSubmit(request, response);
  }

  return response.status(404).json({ error: 'Endpoint not found.' });
}

async function handleReserve(request, response) {
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

    if (!VALID_TIERS.includes(tier) || !isValidTicketNumber(number) || !fullName || !phone) {
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
    const expiresAt = Timestamp.fromMillis(now + SHORT_RESERVATION_MS);

    await db.runTransaction(async (transaction) => {
      const [reservationSnapshot, boardSnapshot, confirmedEntrySnapshot] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(boardRef),
        transaction.get(confirmedEntryQuery),
      ]);

      const isTaken = (snapshot) => {
        if (!snapshot.exists) return false;
        const existing = snapshot.data();
        return existing.status === 'approved' || 
               existing.status === 'pending' || 
               (existing.status === 'reserved' && existing.expiresAt?.toMillis() > now);
      };

      if (confirmedEntrySnapshot.size > 0 || isTaken(reservationSnapshot) || isTaken(boardSnapshot)) {
        const error = new Error('Ticket number is already reserved or purchased.');
        error.code = 'TICKET_TAKEN';
        throw error;
      }

      const reservationData = {
        ownerUid: user.uid,
        tier: tierCode,
        number: numberCode,
        fullName,
        phone,
        status: 'reserved',
        reservedAt: FieldValue.serverTimestamp(),
        expiresAt,
      };

      transaction.set(reservationRef, reservationData);
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
    return response.status(400).json({ error: 'Could not select this ticket.' });
  }
}

async function handleSubmit(request, response) {
  try {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      return response.status(401).json({ error: 'Authentication required.' });
    }

    const app = getFirebaseAdminApp();
    const user = await getAuth(app).verifyIdToken(authorization.slice(7));
    const reservationId = typeof request.body?.reservationId === 'string' ? request.body.reservationId.trim() : '';
    const receiptUrl = typeof request.body?.receiptUrl === 'string' ? request.body.receiptUrl.trim() : '';

    if (!reservationId || !receiptUrl) {
      return response.status(400).json({ error: 'Reservation ID and receipt URL are required.' });
    }

    const db = getFirestore(app);
    const reservationRef = db.collection('ticketReservations').doc(reservationId);

    let entryId = '';
    await db.runTransaction(async (transaction) => {
      const reservationSnapshot = await transaction.get(reservationRef);
      if (!reservationSnapshot.exists) {
        const error = new Error('Reservation not found.');
        error.code = 'RESERVATION_NOT_FOUND';
        throw error;
      }

      const reservation = reservationSnapshot.data();
      if (reservation.ownerUid !== user.uid) {
        const error = new Error('Unauthorized access to this ticket.');
        error.code = 'UNAUTHORIZED';
        throw error;
      }

      const tierNumber = Number(reservation.tier);
      const entryRef = db.collection('entries').doc();
      entryId = entryRef.id;

      transaction.set(entryRef, {
        tier: tierNumber,
        number: reservation.number,
        fullName: reservation.fullName,
        phone: reservation.phone,
        phoneLast4: reservation.phone.slice(-4),
        uid: user.uid,
        receiptUrl,
        status: 'pending',
        ticketReservationId: reservationId,
        createdAt: FieldValue.serverTimestamp(),
      });

      transaction.set(db.collection('entryPrivate').doc(entryId), {
        uid: user.uid,
        phone: reservation.phone,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Set extended 24-hour expiration window so frontend grid keeps the lock visible
      const pendingExpiresAt = Timestamp.fromMillis(Date.now() + PENDING_WINDOW_MS);

      transaction.update(reservationRef, {
        status: 'pending',
        receiptUrl,
        expiresAt: pendingExpiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.update(db.collection('ticketBoard').doc(reservationId), {
        status: 'pending',
        receiptUrl,
        expiresAt: pendingExpiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return response.status(200).json({ success: true, entryId });
  } catch (error) {
    console.error('Receipt submission error:', error);
    return response.status(400).json({ code: error.code || 'SUBMISSION_FAILED', error: error.message });
  }
}