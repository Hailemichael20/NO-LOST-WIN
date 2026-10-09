import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { buildTemporaryPassword } from '../lib/password-change.js';

function normalizePhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('0')) return `+251${trimmed.slice(1)}`;
  return trimmed;
}

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return response.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const app = getFirebaseAdminApp();
    const adminAuth = getAuth(app);
    const db = getFirestore(app);
    const token = await adminAuth.verifyIdToken(authorization.slice(7));

    if (token.admin !== true) {
      return response.status(403).json({ error: 'Administrator access is required.' });
    }

    const identifier = String(request.body?.identifier || '').trim();
    const uid = typeof request.body?.uid === 'string' ? request.body.uid : '';

    let targetUid = uid;
    let targetUser = null;

    if (!targetUid && identifier) {
      if (identifier.includes('@')) {
        try {
          targetUser = await adminAuth.getUserByEmail(identifier);
        } catch {
          targetUser = null;
        }
      } else {
        const normalizedPhone = normalizePhone(identifier);
        const userSnapshot = await db.collection('users').where('phone', '==', normalizedPhone).limit(1).get();
        if (!userSnapshot.empty) {
          targetUid = userSnapshot.docs[0].id;
        }
      }
    }

    if (targetUid && !targetUser) {
      targetUser = await adminAuth.getUser(targetUid).catch(() => null);
    }

    if (!targetUser || !targetUser.uid) {
      return response.status(404).json({ error: 'No linked Firebase account was found for that user.' });
    }

    const targetUidFinal = targetUser.uid;
    const now = Date.now();
    const dailyWindow = new Date(now - 24 * 60 * 60 * 1000);
    const monthlyWindow = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [dailyResetSnapshot, monthlyResetSnapshot] = await Promise.all([
      db.collection('passwordResets')
        .where('targetUid', '==', targetUidFinal)
        .where('createdAt', '>=', dailyWindow)
        .limit(3)
        .get(),
      db.collection('passwordResets')
        .where('targetUid', '==', targetUidFinal)
        .where('createdAt', '>=', monthlyWindow)
        .limit(6)
        .get(),
    ]);

    if (dailyResetSnapshot.size >= 2 || monthlyResetSnapshot.size >= 5) {
      return response.status(429).json({ error: 'Daily or monthly reset limit reached.' });
    }

    const temporaryPassword = buildTemporaryPassword();
    const updatedUser = await adminAuth.updateUser(targetUidFinal, { password: temporaryPassword });
    await db.collection('users').doc(targetUidFinal).set({
      mustChangePassword: true,
      passwordChangeRequiredAt: FieldValue.serverTimestamp(),
      ...(updatedUser.metadata.passwordUpdatedAt
        ? { passwordChangeRequiredPasswordUpdatedAt: updatedUser.metadata.passwordUpdatedAt }
        : {}),
    }, { merge: true });

    await db.collection('passwordResets').add({
      adminUid: token.uid,
      targetUid: targetUidFinal,
      createdAt: FieldValue.serverTimestamp(),
      result: 'success',
    });

    if (identifier) {
      const requestSnapshot = await db.collection('passwordResetRequests')
        .where('identifier', '==', identifier.toLowerCase())
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      if (!requestSnapshot.empty) {
        const requestDoc = requestSnapshot.docs[0];
        await requestDoc.ref.update({ status: 'done', resolvedAt: FieldValue.serverTimestamp() });
      }
    }

    return response.status(200).json({
      ok: true,
      temporaryPassword,
      message: 'The temporary password was created once and returned here. Save it privately and ask the user to change it after login.',
    });
  } catch (error) {
    console.error('Admin password reset error:', error);
    const message = error.message || 'Could not reset the password.';
    if (message.includes('not found')) {
      return response.status(404).json({ error: 'No linked Firebase account was found for that user.' });
    }
    return response.status(500).json({ error: message });
  }
}
