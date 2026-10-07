import crypto from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

const ONE_MINUTE = 60 * 1000;
const RECENT_WINDOW_MS = 10 * ONE_MINUTE;
const DAILY_WINDOW_MS = 24 * 60 * ONE_MINUTE;
const MONTHLY_WINDOW_MS = 30 * DAILY_WINDOW_MS;

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.socket?.remoteAddress || 'unknown';
}

function normalizeIdentifier(identifier) {
  return String(identifier || '').trim().toLowerCase();
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  const identifier = normalizeIdentifier(request.body?.identifier);
  if (!identifier || identifier.length < 3 || identifier.length > 128) {
    return response.status(400).json({ error: 'Please enter a valid phone number or email address.' });
  }

  try {
    const app = getFirebaseAdminApp();
    const db = getFirestore(app);
    const now = Date.now();
    const ipHash = hashValue(getClientIp(request));
    const identifierHash = hashValue(identifier);

    const [recentIpQuery, recentIdentifierQuery, dailyIdentifierQuery, monthlyIdentifierQuery] = await Promise.all([
      db.collection('passwordResetRequests')
        .where('ipHash', '==', ipHash)
        .where('createdAt', '>=', new Date(now - RECENT_WINDOW_MS))
        .limit(5)
        .get(),
      db.collection('passwordResetRequests')
        .where('identifierHash', '==', identifierHash)
        .where('createdAt', '>=', new Date(now - RECENT_WINDOW_MS))
        .limit(3)
        .get(),
      db.collection('passwordResetRequests')
        .where('identifierHash', '==', identifierHash)
        .where('createdAt', '>=', new Date(now - DAILY_WINDOW_MS))
        .limit(3)
        .get(),
      db.collection('passwordResetRequests')
        .where('identifierHash', '==', identifierHash)
        .where('createdAt', '>=', new Date(now - MONTHLY_WINDOW_MS))
        .limit(5)
        .get(),
    ]);

    if (recentIpQuery.size >= 5 || recentIdentifierQuery.size >= 3 || dailyIdentifierQuery.size >= 2 || monthlyIdentifierQuery.size >= 5) {
      return response.status(429).json({ error: 'Rate limit reached. Please try again later.' });
    }

    await db.collection('passwordResetRequests').add({
      identifier,
      identifierHash,
      ipHash,
      createdAt: FieldValue.serverTimestamp(),
      status: 'pending',
      source: 'public',
    });

    return response.status(200).json({
      ok: true,
      message: 'If this account exists, the admin will contact you.',
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    return response.status(500).json({ error: 'Could not submit the reset request. Try again later.' });
  }
}
