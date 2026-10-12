import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { getPasswordChangeRequirementStatus, toEpochMillis } from '../lib/password-change-required.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

const PASSWORD_UPDATE_CHECK_DELAYS_MS = [0, 250, 500, 1000];

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
    let token;
    try {
      token = await adminAuth.verifyIdToken(authorization.slice(7));
    } catch {
      return response.status(401).json({ error: 'Authentication required.' });
    }

    const userRef = getFirestore(app).collection('users').doc(token.uid);
    const db = getFirestore(app);
    let result = 'password-not-changed';
    for (const delayMs of PASSWORD_UPDATE_CHECK_DELAYS_MS) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const userRecord = await adminAuth.getUser(token.uid);
      result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(userRef);
        const userData = snapshot.exists ? snapshot.data() : null;
        const adminResetTime = userData?.passwordChangeRequiredPasswordUpdatedAt
          || userData?.passwordChangeRequiredAt
          || null;
        const adminResetTimeSource = userData?.passwordChangeRequiredPasswordUpdatedAt
          ? 'users.passwordChangeRequiredPasswordUpdatedAt (Firebase Auth ISO timestamp)'
          : userData?.passwordChangeRequiredAt
            ? 'users.passwordChangeRequiredAt (Firestore Timestamp)'
            : 'missing';
        const passwordChangedTime = userRecord.metadata.passwordUpdatedAt || null;

        console.log('Password reset timestamp comparison:', {
          uid: token.uid,
          attempt: attempt + 1,
          adminResetTime,
          adminResetTimeMillis: toEpochMillis(adminResetTime),
          adminResetTimeUnit: 'milliseconds since Unix epoch',
          adminResetTimeSource,
          passwordChangedTime,
          passwordChangedTimeMillis: toEpochMillis(passwordChangedTime),
          passwordChangedTimeUnit: 'milliseconds since Unix epoch',
          passwordChangedTimeSource: 'Firebase Admin Auth userRecord.metadata.passwordUpdatedAt (ISO timestamp)',
        });

        const status = getPasswordChangeRequirementStatus(
          userData,
          passwordChangedTime,
        );

        if (status !== 'cleared' || !userData?.mustChangePassword) {
          return status;
        }

        transaction.update(userRef, {
          mustChangePassword: false,
          passwordChangeRequiredAt: FieldValue.delete(),
          passwordChangeRequiredPasswordUpdatedAt: FieldValue.delete(),
        });
        return 'cleared';
      });

      if (result !== 'password-not-changed') break;
    }

    if (result !== 'cleared') {
      return response.status(409).json({
        error: result === 'missing-requirement-time'
          ? 'The password reset is missing its trusted timestamp. Ask an administrator to reset the requirement.'
          : 'The password-change requirement could not be cleared. Change your password after the administrator reset, then try again.',
      });
    }

    return response.status(200).json({ cleared: true });
  } catch (error) {
    console.error('Password-change flag update error:', error);
    return response.status(500).json({ error: 'Could not complete the required password change.' });
  }
}
