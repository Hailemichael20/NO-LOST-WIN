import { applyCors } from '../lib/cors.js';

export default function handler(request, response) {
  if (!applyCors(request, response)) return;
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  response.setHeader('Cache-Control', 'no-store');
  return response.status(200).json({ serverNow: Date.now() });
}
