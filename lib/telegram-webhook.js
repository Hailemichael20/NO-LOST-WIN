import { timingSafeEqual } from 'node:crypto';

export function hasValidTelegramSecret(providedSecret, expectedSecret) {
  if (typeof providedSecret !== 'string'
    || typeof expectedSecret !== 'string'
    || !expectedSecret) return false;

  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function parseReceiptCallback(data) {
  if (typeof data !== 'string') return null;
  const match = /^(approve|reject):([A-Za-z0-9_-]{1,64})$/.exec(data);
  if (!match) return null;
  return { status: match[1] === 'approve' ? 'approved' : 'rejected', entryId: match[2] };
}

export function isTelegramAdminUser(userId, configuredAdminUserId) {
  return /^[0-9]+$/.test(configuredAdminUserId || '')
    && userId !== undefined
    && userId !== null
    && String(userId) === configuredAdminUserId;
}
