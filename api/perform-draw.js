import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { freezeTicketNumbers } from '../lib/draw-schedule.js';

const VALID_TIERS = [50, 100, 200, 500];

function drawError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
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
      return response.status(400).json({ error: 'A valid draw category is required.' });
    }
    const redrawReason = typeof request.body?.redrawReason === 'string'
      ? request.body.redrawReason.trim()
      : '';
    if (redrawReason.length > 500) {
      return response.status(400).json({ error: 'The redraw reason must be 500 characters or fewer.' });
    }

    const db = getFirestore(app);
    const scheduleRef = db.collection('drawSchedule').doc(String(tier));
    const lockRef = db.collection('drawLocks').doc(String(tier));
    const approvedTicketsQuery = db.collection('ticketBoard')
      .where('tier', '==', String(tier))
      .where('status', '==', 'approved')
      .orderBy('number', 'asc');
    const previousDrawQuery = db.collection('drawEvents')
      .where('tier', '==', tier)
      .orderBy('createdAt', 'desc')
      .limit(1);
    const drawEventRef = db.collection('drawEvents').doc();
    const spinId = crypto.randomUUID();

    const result = await db.runTransaction(async (transaction) => {
      // Reading and updating this lock serializes concurrent spins for the same tier.
      const [scheduleSnapshot, , ticketsSnapshot, previousDrawSnapshot] = await Promise.all([
        transaction.get(scheduleRef),
        transaction.get(lockRef),
        transaction.get(approvedTicketsQuery),
        transaction.get(previousDrawQuery),
      ]);

      if (!scheduleSnapshot.exists) {
        throw drawError(409, 'Set a draw time for this category before spinning.');
      }
      const scheduledAt = scheduleSnapshot.data().drawAt;
      if (!scheduledAt?.toMillis || scheduledAt.toMillis() > Date.now()) {
        throw drawError(409, 'The scheduled draw time has not been reached.');
      }
      if (!previousDrawSnapshot.empty && redrawReason.length < 10) {
        throw drawError(400, 'A redraw reason of at least 10 characters is required.');
      }

      const ticketDocs = ticketsSnapshot.docs.map((ticketDoc) => ({
        id: ticketDoc.id,
        ...ticketDoc.data(),
      }));
      const { numbers, canonicalList } = freezeTicketNumbers(tier, ticketDocs);
      if (numbers.length === 0) {
        throw drawError(409, 'No approved tickets are available for this category.');
      }

      const winningIndex = crypto.randomInt(numbers.length);
      const winnerNumber = numbers[winningIndex];
      const winnerTicket = ticketDocs.find((ticket) => Number(ticket.number) === winnerNumber);
      const frozenTicketsHash = crypto.createHash('sha256')
        .update(JSON.stringify(canonicalList))
        .digest('hex');
      const createdAt = Timestamp.now();
      const event = {
        category: tier,
        tier,
        createdAt: FieldValue.serverTimestamp(),
        scheduledAt,
        winnerNumber,
        winnerPhoneLast4: String(winnerTicket?.phoneLast4 || '').slice(-4),
        approvedTicketCount: numbers.length,
        frozenNumbers: numbers,
        frozenTicketsHash,
        spinId,
        adminUid: token.uid,
        status: 'completed',
        ...(redrawReason ? { redrawReason } : {}),
      };

      transaction.create(drawEventRef, event);
      transaction.set(lockRef, {
        tier,
        lastSpinId: spinId,
        lastDrawAt: createdAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        drawEventId: drawEventRef.id,
        spinId,
        tier,
        winnerNumber,
        winnerPhoneLast4: event.winnerPhoneLast4,
        approvedTicketCount: numbers.length,
        frozenTicketsHash,
        createdAt: createdAt.toMillis(),
        redraw: !previousDrawSnapshot.empty,
      };
    });

    return response.status(200).json(result);
  } catch (error) {
    console.error('Lottery draw error:', error);
    return response.status(error.statusCode || 500).json({
      error: error.message || 'Could not complete the draw.',
    });
  }
}
