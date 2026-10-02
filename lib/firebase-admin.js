import { cert, getApps, initializeApp } from 'firebase-admin/app';

export function resolveFirebaseAdminCredentialConfig() {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  let serviceAccount = null;

  if (serviceAccountRaw.trim()) {
    try {
      const parsed = JSON.parse(serviceAccountRaw);
      if (parsed && typeof parsed === 'object') {
        serviceAccount = parsed;
      }
    } catch {
      // Some deployments provide a JSON string or a different credential source; ignore parse failures and fall back to explicit env vars.
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || serviceAccount?.project_id || '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || serviceAccount?.client_email || '';
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || serviceAccount?.private_key || '').replace(/\\n/g, '\n');

  return { projectId, clientEmail, privateKey };
}

export function getFirebaseAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const { projectId, clientEmail, privateKey } = resolveFirebaseAdminCredentialConfig();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin environment variables are not configured.');
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}
