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

    const db = getFirestore(app);
    const [entrySnapshot, privateEntrySnapshot] = await Promise.all([
      db.collection('entries').doc(entryId).get(),
      db.collection('entryPrivate').doc(entryId).get(),
    ]);
    if (!entrySnapshot.exists) {
      return response.status(404).json({ error: 'Receipt not found.' });
    }

    const entry = entrySnapshot.data();
    const privateEntry = privateEntrySnapshot.exists ? privateEntrySnapshot.data() : entry;
    if (privateEntry.userId !== token.uid) {
      return response.status(403).json({ error: 'You cannot notify for this receipt.' });
    }
    if (entry.status !== 'pending') {
      return response.status(409).json({ error: 'Only pending receipts can be sent for review.' });
    }

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      return response.status(503).json({ error: 'Telegram notification is not configured.' });
    }

    const createdAt = entry.createdAt?.toDate
      ? entry.createdAt.toDate()
      : new Date();
    const ticketNumber = entry.number || privateEntry.number;
    const message = [
      'New payment receipt uploaded / አዲስ የክፍያ ደረሰኝ ተጭኗል',
      `Name / ስም: ${privateEntry.fullName || 'Not provided'}`,
      `Phone / ስልክ: ${privateEntry.phone || 'Not provided'}`,
      `Category / ምድብ: ${entry.tier} Birr`,
      `Number / ቁጥር: ${ticketNumber ? `#${String(ticketNumber).padStart(3, '0')}` : 'Not provided'}`,
      `Time / ሰዓት: ${new Intl.DateTimeFormat('en-ET', {
        timeZone: 'Africa/Addis_Ababa',
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(createdAt)}`,
      `Receipt / ደረሰኝ: ${privateEntry.receiptUrl || 'Unavailable'}`,
    ].join('\n');

    const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        reply_markup: {
          inline_keyboard: [[
            { text: 'Confirm', callback_data: `approve:${entryId}` },
            { text: 'Reject', callback_data: `reject:${entryId}` },
          ]],
        },
        disable_web_page_preview: false,
      }),
    });

    const telegramResult = await telegramResponse.json();
    if (!telegramResponse.ok || !telegramResult.ok) {
      return response.status(502).json({ error: 'Telegram notification failed.' });
    }

    return response.status(200).json({ notified: true });
  } catch (error) {
    console.error('Receipt notification error:', error);
    return response.status(500).json({ error: 'Could not send receipt notification.' });
  }
}
