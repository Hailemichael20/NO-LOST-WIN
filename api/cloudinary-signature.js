import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { applyCors } from '../lib/cors.js';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

function signUploadParams(params, apiSecret) {
  const payload = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

export default async function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return response.status(401).json({ error: 'Authentication required.' });
  }

  let app;
  try {
    app = getFirebaseAdminApp();
  } catch (error) {
    console.error('Cloudinary signature Firebase Admin setup error:', error);
    return response.status(500).json({ error: 'Firebase Admin is not configured on the server.' });
  }

  let token;
  try {
    token = await getAuth(app).verifyIdToken(authorization.slice(7));
  } catch (error) {
    console.error('Cloudinary signature authentication error:', error);
    return response.status(401).json({ error: 'A valid sign-in is required.' });
  }

  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret, CLOUDINARY_UPLOAD_PRESET: uploadPreset } = process.env;
  if (!cloudName || !apiKey || !apiSecret || !uploadPreset) {
    return response.status(503).json({ error: 'Cloudinary is not configured on the server.' });
  }

  const params = {
    folder: `receipts/${token.uid}`,
    timestamp: Math.floor(Date.now() / 1000),
    upload_preset: uploadPreset,
  };

  return response.status(200).json({
    cloudName,
    apiKey,
    ...params,
    signature: signUploadParams(params, apiSecret),
  });
}