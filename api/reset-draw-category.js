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

// Resets ONE draw category (tier) back to a fresh start:
//  - deletes the winners and draw history events of the active round
//  - starts a new, empty draw round and clears the scheduled draw time so admin can set a new one
//  - deletes the confirmed (approved) entries and unlocks their ticket numbers
// Pending, awaiting-payment and rejected entries are NOT touched.
// Wallet balances and wallet transactions are NOT touched.
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

    const db = getFirestore(app);
    const roundRef = db.collection('drawRounds').doc(String(tier));
    const lockRef = db.collection('drawLocks').doc(String(tier));

    // Block the reset while a spin/archive is in progress for this category.
    const lockSnapshot = await lockRef.get();
    if (lockSnapshot.exists && lockSnapshot.data()?.archiving === true) {
      throw resetError(409, 'ROUND_ARCHIVING', 'This category is busy archiving its round. Try again in a moment.');
    }

    const [roundSnapshot, eventsSnapshot, approvedEntriesSnapshot, approvedReservationsSnapshot, approvedBoardSnapshot] = await Promise.all([
      roundRef.get(),
      db.collection('drawEvents').where('tier', '==', tier).get(),
      db.collection('entries').where('tier', '==', tier).where('status', '==', 'approved').get(),
      db.collection('ticketReservations').where('tier', '==', String(tier)).where('status', '==', 'approved').get(),
      db.collection('ticketBoard').where('tier', '==', String(tier)).where('status', '==', 'approved').get(),
    ]);

    // Ticket ids to unlock: from approved entries, plus any approved reservation/board docs.
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

    // 1. Winners and draw events.
    eventsSnapshot.docs.forEach((eventDoc) => writer.delete(eventDoc.ref));

    // 2. Approved entries (public + private) and their locked ticket numbers.
    approvedEntriesSnapshot.docs.forEach((entryDoc) => {
      writer.delete(entryDoc.ref);
      writer.delete(db.collection('entryPrivate').doc(entryDoc.id));
    });
    ticketIds.forEach((ticketId) => {
      writer.delete(db.collection('ticketReservations').doc(ticketId));
      writer.delete(db.collection('ticketBoard').doc(ticketId));
    });

    // 3. Fresh, empty round, unlocked draw lock, and cleared schedule so admin can set a new one.
    writer.set(roundRef, {
      tier,
      roundId: nextRoundId,
      placements: {},
      usedWinnerNumbers: [],
      lastSpin: null,
      drawTime: null, // Clears the scheduled draw time so it can be refilled from the admin side
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writer.set(lockRef, {
      tier,
      archiving: false,
      resetAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 4. Small audit record (server-only collection).
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