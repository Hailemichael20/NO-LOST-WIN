function firstHeaderValue(value) {
  return (Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function isSameOrigin(origin, request) {
  const host = firstHeaderValue(request.headers['x-forwarded-host'] || request.headers.host);
  const protocol = firstHeaderValue(request.headers['x-forwarded-proto']) || 'https';
  return Boolean(host) && origin === `${protocol}://${host}`;
}

export function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;

  const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (!allowedOrigins.has(origin) && !isSameOrigin(origin, request)) {
    response.status(403).json({ error: 'This frontend origin is not allowed.' });
    return false;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Vary', 'Origin');
  return true;
}