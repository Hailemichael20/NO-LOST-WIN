import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { getNextDrawPlacement } from '../lib/draw-round.js';

const VALID_TIERS = [50, 100, 200, 500];

function drawError(statusCode, code, message) {
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

    const db = getFirestore(app);
    const roundRef = db.collection('drawRounds').doc(String(tier));
    const lockRef = db.collection('drawLocks').doc(String(tier));
    const latestDrawQuery = db.collection('drawEvents')
      .where('tier', '==', tier)
      .orderBy('createdAt', 'desc')
      .limit(1);
    const archive = await db.runTransaction(async (transaction) => {
      const [lockSnapshot, roundSnapshot, latestDrawSnapshot] = await Promise.all([
        transaction.get(lockRef),
        transaction.get(roundRef),
        transaction.get(latestDrawQuery),
      ]);
      const lock = lockSnapshot.data() || {};
      const currentRound = roundSnapshot.exists ? roundSnapshot.data() : null;
      const latestLegacyDraw = latestDrawSnapshot.docs[0];
      const isLegacyRound = !currentRound;

      if (currentRound && getNextDrawPlacement(currentRound.placements || {}) !== null) {
        throw drawError(409, 'ROUND_NOT_COMPLETE', 'Draw all three placements before starting a new round.');
      }
      if (isLegacyRound && !latestLegacyDraw) {
        throw drawError(409, 'NO_ROUND_TO_ARCHIVE', 'There is no completed draw round to archive.');
      }
      if (isLegacyRound && latestLegacyDraw.data().roundId) {
        throw drawError(409, 'ROUND_STATE_MISSING', 'The active round state is unavailable.');
      }

      const roundId = currentRound?.roundId
        || lock.archiveRoundId
        || `legacy-${tier}-${latestLegacyDraw.id}`;
      const eventsQuery = currentRound
        ? db.collection('drawEvents').where('tier', '==', tier).where('roundId', '==', roundId)
        : db.collection('drawEvents').where('tier', '==', tier);
      const eventSnapshot = await transaction.get(eventsQuery);
      const events = eventSnapshot.docs
        .filter((eventDoc) => currentRound || !eventDoc.data().roundId)
        .map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() }));

      transaction.set(lockRef, {
        ...lock,
        tier,
        archiving: true,
        archiveRoundId: roundId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      const legacyPlacement = latestLegacyDraw?.data();
      return {
        roundId,
        isLegacyRound,
        events,
        placements: currentRound?.placements || (legacyPlacement ? {
          1: {
            placement: 1,
            drawEventId: latestLegacyDraw.id,
            winnerNumber: legacyPlacement.winnerNumber,
            winnerPhoneLast4: legacyPlacement.winnerPhoneLast4 || '',
          },
        } : {}),
        roundCreatedAt: currentRound?.createdAt || null,
      };
    });

    const historyRef = db.collection('drawHistory').doc(archive.roundId);
    const writer = db.bulkWriter();
    archive.events.forEach((event) => {
      const { id, ...eventData } = event;
      writer.set(historyRef.collection('events').doc(id), eventData);
    });
    await writer.close();
    await historyRef.set({
      roundId: archive.roundId,
      tier,
      placements: archive.placements,
      eventCount: archive.events.length,
      legacy: archive.isLegacyRound,
      createdAt: archive.roundCreatedAt || archive.events[0]?.createdAt || FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: token.uid,
    });

    const nextRoundId = crypto.randomUUID();
    await db.runTransaction(async (transaction) => {
      const [lockSnapshot, roundSnapshot] = await Promise.all([
        transaction.get(lockRef),
        transaction.get(roundRef),
      ]);
      if (lockSnapshot.data()?.archiving !== true
        || lockSnapshot.data()?.archiveRoundId !== archive.roundId
        || (roundSnapshot.exists && roundSnapshot.data().roundId !== archive.roundId)
        || (!roundSnapshot.exists && !archive.isLegacyRound)) {
        throw drawError(409, 'ROUND_CHANGED', 'The round changed while it was being archived.');
      }

      transaction.set(roundRef, {
        tier,
        roundId: nextRoundId,
        placements: {},
        usedWinnerNumbers: [],
        lastSpin: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(lockRef, {
        tier,
        archiving: false,
        archivedRoundId: archive.roundId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return response.status(200).json({ tier, archivedRoundId: archive.roundId, roundId: nextRoundId });
  } catch (error) {
    console.error('Start draw round error:', error);
    return response.status(error.statusCode || 500).json({
      code: error.code || 'START_ROUND_FAILED',
      error: error.message || 'Could not start a new draw round.',
    });
  }
}