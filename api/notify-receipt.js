import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const authorization = request.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      return response.status(401).json({ error: 'Authentication required.' });
    }

    const app = getFirebaseAdminApp();
    const token = await getAuth(app).verifyIdToken(authorization.slice(7));
    const entryId = request.body?.entryId;

    if (typeof entryId !== 'string' || !entryId) {
      return response.status(400).json({ error: 'A receipt entry ID is required.' });
    }

    const entrySnapshot = await getFirestore(app).collection('entries').doc(entryId).get();
    if (!entrySnapshot.exists) {
      return response.status(404).json({ error: 'Receipt not found.' });
    }

    const entry = entrySnapshot.data();
    if (entry.userId !== token.uid) {
      return response.status(403).json({ error: 'You cannot notify for this receipt.' });
    }

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      return response.status(503).json({ error: 'Telegram notification is not configured.' });
    }

    const message = [
      'New payment receipt uploaded',
      `Participant: ${entry.fullName || 'Unknown'}`,
      `Phone: ${entry.phone || 'Unknown'}`,
      `Category: ${entry.tier || 'Unknown'} Birr`,
      `Receipt: ${entry.receiptUrl || 'Unavailable'}`,
      'Review it in the admin dashboard before approving the wallet credit.',
    ].join('\n');

    const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        disable_web_page_preview: false,
      }),
    });

    if (!telegramResponse.ok) {
      return response.status(502).json({ error: 'Telegram notification failed.' });
    }

    return response.status(200).json({ notified: true });
  } catch (error) {
    console.error('Receipt notification error:', error);
    return response.status(500).json({ error: 'Could not send receipt notification.' });
  }
}
