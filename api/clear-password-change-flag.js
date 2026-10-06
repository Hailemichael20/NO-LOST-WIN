import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { applyCors } from '../lib/cors.js';
import { hasPasswordChangedSinceRequirement } from '../lib/password-change-required.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

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
    const result = await getFirestore(app).runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists || snapshot.data().mustChangePassword !== true) {
        return 'not-required';
      }

      const { passwordChangeRequiredAt } = snapshot.data();
      if (!passwordChangeRequiredAt || typeof passwordChangeRequiredAt.toMillis !== 'function') {
        return 'missing-requirement-time';
      }

      const userRecord = await adminAuth.getUser(token.uid);
      if (!hasPasswordChangedSinceRequirement(
        userRecord.metadata.passwordUpdatedAt,
        passwordChangeRequiredAt,
      )) {
        return 'password-not-changed';
      }

      transaction.update(userRef, {
        mustChangePassword: false,
        passwordChangeRequiredAt: FieldValue.delete(),
      });
      return 'cleared';
    });

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
