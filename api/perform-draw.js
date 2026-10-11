import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { freezeTicketNumbers } from '../lib/draw-schedule.js';
import { getAvailableWinnerNumbers, getNextDrawPlacement } from '../lib/draw-round.js';

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
    const redrawReason = typeof request.body?.redrawReason === 'string'
      ? request.body.redrawReason.trim()
      : '';
    if (redrawReason.length > 500) {
      return response.status(400).json({
        code: 'INVALID_REDRAW_REASON',
        error: 'The redraw reason must be 500 characters or fewer.',
      });
    }

    const db = getFirestore(app);
    const scheduleRef = db.collection('drawSchedule').doc(String(tier));
    const lockRef = db.collection('drawLocks').doc(String(tier));
    const roundRef = db.collection('drawRounds').doc(String(tier));
    const approvedTicketsQuery = db.collection('entries')
      .where('tier', '==', tier)
      .where('status', '==', 'approved')
      .orderBy('number', 'asc');
    const previousDrawQuery = db.collection('drawEvents')
      .where('tier', '==', tier)
      .orderBy('createdAt', 'desc')
      .limit(1);
    const drawEventRef = db.collection('drawEvents').doc();
    const spinId = crypto.randomUUID();
    const newRoundId = crypto.randomUUID();

    const result = await db.runTransaction(async (transaction) => {
      // Reading and updating this lock serializes concurrent spins for the same tier.
      const [scheduleSnapshot, lockSnapshot, roundSnapshot, ticketsSnapshot, previousDrawSnapshot] = await Promise.all([
        transaction.get(scheduleRef),
        transaction.get(lockRef),
        transaction.get(roundRef),
        transaction.get(approvedTicketsQuery),
        transaction.get(previousDrawQuery),
      ]);

      if (!scheduleSnapshot.exists) {
        throw drawError(409, 'DRAW_NOT_SCHEDULED', 'Set a draw time for this category before spinning.');
      }
      const scheduledAt = scheduleSnapshot.data().drawAt;
      if (!scheduledAt?.toMillis || scheduledAt.toMillis() > Date.now()) {
        throw drawError(409, 'DRAW_TIME_NOT_REACHED', 'The scheduled draw time has not been reached.');
      }
      if (lockSnapshot.data()?.archiving === true) {
        throw drawError(409, 'ROUND_ARCHIVING', 'This category is archiving its previous round.');
      }
      if (!roundSnapshot.exists && !previousDrawSnapshot.empty) {
        throw drawError(409, 'START_NEW_ROUND_REQUIRED', 'Start a new draw round before spinning this category.');
      }

      const currentRound = roundSnapshot.exists ? roundSnapshot.data() : {
        roundId: newRoundId,
        placements: {},
        usedWinnerNumbers: [],
      };
      const roundId = currentRound.roundId;
      const placements = currentRound.placements || {};
      const nextPlacement = getNextDrawPlacement(placements);
      const isRedraw = nextPlacement === null;
      const replacedPlacement = Number(request.body?.replacedPlacement);
      let placement = nextPlacement;
      let replacedEventRef = null;

      if (isRedraw) {
        if (redrawReason.length < 10) {
          throw drawError(400, 'REDRAW_REASON_REQUIRED', 'A redraw reason of at least 10 characters is required.');
        }
        if (![1, 2, 3].includes(replacedPlacement) || !placements[String(replacedPlacement)]) {
          throw drawError(400, 'REDRAW_PLACEMENT_REQUIRED', 'Choose a filled placement to redraw.');
        }
        placement = replacedPlacement;
        replacedEventRef = db.collection('drawEvents').doc(placements[String(placement)].drawEventId);
      }

      const ticketDocs = ticketsSnapshot.docs.map((ticketDoc) => ({
        id: ticketDoc.id,
        ...ticketDoc.data(),
      }));
      const { numbers, duplicateNumbers } = freezeTicketNumbers(tier, ticketDocs);
      if (duplicateNumbers.length > 0) {
        throw drawError(
          409,
          'DUPLICATE_APPROVED_TICKETS',
          'Duplicate confirmed ticket numbers must be resolved before this draw.',
        );
      }
      if (numbers.length === 0) {
        throw drawError(409, 'NO_APPROVED_TICKETS', 'No approved tickets are available for this category.');
      }

      const eligibleNumbers = getAvailableWinnerNumbers(numbers, currentRound.usedWinnerNumbers || []);
      if (eligibleNumbers.length === 0) {
        throw drawError(409, 'NO_ELIGIBLE_TICKETS', 'No eligible tickets remain for this draw.');
      }
      const replacedEventSnapshot = replacedEventRef
        ? await transaction.get(replacedEventRef)
        : null;
      if (replacedEventSnapshot && !replacedEventSnapshot.exists) {
        throw drawError(409, 'ROUND_STATE_INVALID', 'The winner being replaced could not be found.');
      }

      const winningIndex = crypto.randomInt(eligibleNumbers.length);
      const winnerNumber = eligibleNumbers[winningIndex];
      const winnerTicket = ticketDocs.find((ticket) => Number(ticket.number) === winnerNumber);
      const eligibleCanonicalList = eligibleNumbers.map((number) => `${tier}-${String(number).padStart(3, '0')}`);
      const frozenTicketsHash = crypto.createHash('sha256')
        .update(JSON.stringify(eligibleCanonicalList))
        .digest('hex');
      const createdAt = Timestamp.now();
      const event = {
        category: tier,
        tier,
        roundId,
        placement: isRedraw ? 'redraw' : placement,
        ...(isRedraw ? { replacedPlacement: placement, redrawReason } : {}),
        createdAt: FieldValue.serverTimestamp(),
        scheduledAt,
        winnerNumber,
        winnerPhoneLast4: String(winnerTicket?.phoneLast4 || '').slice(-4),
        approvedTicketCount: numbers.length,
        eligibleTicketCount: eligibleNumbers.length,
        frozenNumbers: eligibleNumbers,
        frozenTicketsHash,
        spinId,
        adminUid: token.uid,
        status: 'completed',
      };

      if (replacedEventSnapshot) {
        transaction.update(replacedEventRef, {
          status: 'replaced',
          replacedByDrawEventId: drawEventRef.id,
          replacementReason: redrawReason,
          replacedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.create(drawEventRef, event);
      const placementSummary = {
        drawEventId: drawEventRef.id,
        placement,
        winnerNumber,
        winnerPhoneLast4: event.winnerPhoneLast4,
      };
      transaction.set(roundRef, {
        tier,
        roundId,
        placements: { ...placements, [String(placement)]: placementSummary },
        usedWinnerNumbers: [...(currentRound.usedWinnerNumbers || []), winnerNumber],
        lastSpin: {
          drawEventId: drawEventRef.id,
          placement: event.placement,
          ...(isRedraw ? { replacedPlacement: placement } : {}),
          winnerNumber,
          winnerPhoneLast4: event.winnerPhoneLast4,
          frozenNumbers: eligibleNumbers,
          frozenTicketsHash,
          spinId,
          createdAt,
        },
        createdAt: currentRound.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(lockRef, {
        tier,
        lastSpinId: spinId,
        lastDrawAt: createdAt,
        archiving: false,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        drawEventId: drawEventRef.id,
        spinId,
        tier,
        roundId,
        placement: event.placement,
        replacedPlacement: isRedraw ? placement : null,
        winnerNumber,
        winnerPhoneLast4: event.winnerPhoneLast4,
        approvedTicketCount: numbers.length,
        eligibleTicketCount: eligibleNumbers.length,
        frozenTicketsHash,
        createdAt: createdAt.toMillis(),
        redraw: isRedraw,
      };
    });

    return response.status(200).json(result);
  } catch (error) {
    console.error('Lottery draw error:', error);
    return response.status(error.statusCode || 500).json({
      code: error.code || 'DRAW_FAILED',
      error: error.message || 'Could not complete the draw.',
    });
  }
}
