import { auth } from './firebaseConfig';

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export async function uploadReceiptImage(file, onProgress = () => {}) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Please upload a JPG, PNG, or WebP image.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Receipt image must be under 5MB.');
  }

  const currentUser = auth?.currentUser;
  if (!currentUser) throw new Error('Please sign in before uploading a receipt.');

  const idToken = await currentUser.getIdToken();
  const signatureResponse = await fetch(`${apiBaseUrl}/api/cloudinary-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const signatureData = await signatureResponse.json().catch(() => ({}));
  if (!signatureResponse.ok) {
    throw new Error(signatureData.error || 'Could not prepare the receipt upload.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signatureData.apiKey);
  formData.append('timestamp', String(signatureData.timestamp));
  formData.append('folder', signatureData.folder);
  formData.append('upload_preset', signatureData.upload_preset);
  formData.append('signature', signatureData.signature);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `https://api.cloudinary.com/v1_1/${signatureData.cloudName}/image/upload`);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      let result = {};
      try {
        result = JSON.parse(request.responseText);
      } catch {
        reject(new Error('Cloudinary returned an invalid upload response.'));
        return;
      }

      if (request.status < 200 || request.status >= 300 || !result.secure_url) {
        reject(new Error(result.error?.message || 'Cloudinary could not upload the receipt.'));
        return;
      }

      resolve(result.secure_url);
    });
    request.addEventListener('error', () => reject(new Error('The receipt upload could not reach Cloudinary.')));
    request.send(formData);
  });
}