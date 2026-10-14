import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

const VALID_TIERS = [50, 100, 200, 500];

function resetError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

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
    const token = await getAuth(app).verifyIdToken(authorization.slice(7));
    if (token.admin !== true) {
      return response.status(403).json({ error: 'Administrator access is required.' });
    }

    const tier = Number(request.body?.tier);
    if (!VALID_TIERS.includes(tier)) {
      return response.status(400).json({ code: 'INVALID_CATEGORY', error: 'A valid draw category is required.' });
    }

    const tierCode = String(tier);
    const db = getFirestore(app);
    const roundRef = db.collection('drawRounds').doc(tierCode);
    const scheduleRef = db.collection('drawSchedule').doc(tierCode); // Crucial for clearing draw time reached
    const lockRef = db.collection('drawLocks').doc(tierCode);

    const lockSnapshot = await lockRef.get();
    if (lockSnapshot.exists && lockSnapshot.data()?.archiving === true) {
      throw resetError(409, 'ROUND_ARCHIVING', 'This category is busy archiving its round. Try again in a moment.');
    }

    const [roundSnapshot, eventsSnapshot, approvedEntriesSnapshot, approvedReservationsSnapshot, approvedBoardSnapshot] = await Promise.all([
      roundRef.get(),
      db.collection('drawEvents').where('tier', '==', tier).get(),
      db.collection('entries').where('tier', '==', tier).where('status', '==', 'approved').get(),
      db.collection('ticketReservations').where('tier', '==', tierCode).where('status', '==', 'approved').get(),
      db.collection('ticketBoard').where('tier', '==', tierCode).where('status', '==', 'approved').get(),
    ]);

    const ticketIds = new Set();
    approvedEntriesSnapshot.docs.forEach((entryDoc) => {
      const ticketReservationId = entryDoc.data().ticketReservationId;
      if (ticketReservationId) ticketIds.add(ticketReservationId);
    });
    approvedReservationsSnapshot.docs.forEach((reservationDoc) => ticketIds.add(reservationDoc.id));
    approvedBoardSnapshot.docs.forEach((boardDoc) => ticketIds.add(boardDoc.id));

    const previousPlacements = roundSnapshot.exists ? (roundSnapshot.data().placements || {}) : {};
    const nextRoundId = crypto.randomUUID();
    const writer = db.bulkWriter();
    let writeFailed = false;
    writer.onWriteError((error) => {
      if (error.failedAttempts < 5) return true;
      writeFailed = true;
      console.error('Reset category write failed:', error);
      return false;
    });

    // Delete schedule so "Draw time reached" goes away
    writer.delete(scheduleRef);

    eventsSnapshot.docs.forEach((eventDoc) => writer.delete(eventDoc.ref));

    approvedEntriesSnapshot.docs.forEach((entryDoc) => {
      writer.delete(entryDoc.ref);
      writer.delete(db.collection('entryPrivate').doc(entryDoc.id));
    });
    ticketIds.forEach((ticketId) => {
      writer.delete(db.collection('ticketReservations').doc(ticketId));
      writer.delete(db.collection('ticketBoard').doc(ticketId));
    });

    writer.set(roundRef, {
      tier,
      roundId: nextRoundId,
      placements: {},
      usedWinnerNumbers: [],
      lastSpin: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writer.set(lockRef, {
      tier,
      archiving: false,
      resetAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writer.create(db.collection('adminLogs').doc(), {
      type: 'reset_draw_category',
      tier,
      adminUid: token.uid,
      previousRoundId: roundSnapshot.exists ? roundSnapshot.data().roundId || null : null,
      previousPlacements,
      deletedEntries: approvedEntriesSnapshot.size,
      deletedDrawEvents: eventsSnapshot.size,
      unlockedTickets: ticketIds.size,
      createdAt: FieldValue.serverTimestamp(),
    });

    await writer.close();
    if (writeFailed) {
      throw resetError(500, 'RESET_INCOMPLETE', 'The reset did not finish. Please press the reset button again.');
    }

    return response.status(200).json({
      tier,
      roundId: nextRoundId,
      deletedEntries: approvedEntriesSnapshot.size,
      deletedDrawEvents: eventsSnapshot.size,
      unlockedTickets: ticketIds.size,
    });
  } catch (error) {
    console.error('Reset draw category error:', error);
    return response.status(error.statusCode || 500).json({
      code: error.code || 'RESET_FAILED',
      error: error.message || 'Could not reset this category.',
    });
  }
}