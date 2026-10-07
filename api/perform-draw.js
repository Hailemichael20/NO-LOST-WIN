import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

const VALID_TIERS = [50, 100, 200, 500];

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST' && request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const authorization = request.headers.authorization || '';
    const cronSecret = process.env.CRON_SECRET || '';
    const hasCronAccess = authorization.startsWith('Bearer ')
      && cronSecret
      && authorization.slice(7) === cronSecret;

    if (!hasCronAccess) {
      if (!authorization.startsWith('Bearer ')) {
        return response.status(401).json({ error: 'Authentication required.' });
      }

      const app = getFirebaseAdminApp();
      const token = await getAuth(app).verifyIdToken(authorization.slice(7));
      if (token.admin !== true) {
        return response.status(403).json({ error: 'Administrator access is required.' });
      }
    }

    const app = getFirebaseAdminApp();
    const db = getFirestore(app);
    const rawTier = Number(request.body?.tier ?? request.query?.tier ?? 100);
    const tier = VALID_TIERS.includes(rawTier) ? rawTier : 100;

    const publicTicketDocs = await db
      .collection('publicApprovedTickets')
      .where('tier', '==', tier)
      .where('status', '==', 'approved')
      .get();

    const tickets = publicTicketDocs.docs
      .map((doc) => doc.data())
      .filter((ticket) => Number.isFinite(Number(ticket.number)) && Number(ticket.number) >= 1)
      .sort((a, b) => Number(a.number) - Number(b.number));

    if (tickets.length === 0) {
      return response.status(404).json({ error: 'No approved tickets are available for this category.' });
    }

    const ticketHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(tickets.map((ticket) => `${tier}-${ticket.number}`)))
      .digest('hex');

    const winner = tickets[crypto.randomInt(tickets.length)];
    const timestamp = Timestamp.now();
    const eventRecord = {
      tier,
      createdAt: timestamp,
      winnerNumber: Number(winner.number),
      winnerPhoneLast4: String(winner.phoneLast4 || '').slice(-4),
      approvedTicketCount: tickets.length,
      frozenTicketsHash: ticketHash,
      source: hasCronAccess ? 'cron' : 'manual',
      status: 'completed',
      finalizedAt: FieldValue.serverTimestamp(),
    };

    const eventRef = await db.collection('drawEvents').add(eventRecord);

    return response.status(200).json({
      drawEventId: eventRef.id,
      tier,
      winnerNumber: Number(winner.number),
      winnerPhoneLast4: String(winner.phoneLast4 || '').slice(-4),
      approvedTicketCount: tickets.length,
      frozenTicketsHash: ticketHash,
      createdAt: timestamp.toMillis(),
    });
  } catch (error) {
    console.error('Lottery draw error:', error);
    return response.status(400).json({ error: error.message || 'Could not complete the draw.' });
  }
}
