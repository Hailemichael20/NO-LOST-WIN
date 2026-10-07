const VALID_TIERS = new Set(['50', '100', '200', '500']);

export function toPublicEntry({ tier, number, status, phoneLast4, phone }) {
  const safeTier = String(tier);
  const safeNumber = String(number);
  const safePhoneLast4 = String(phoneLast4 || phone || '').replace(/\D/g, '').slice(-4);
  if (status !== 'approved'
    || !VALID_TIERS.has(safeTier)
    || !/^(?!000)\d{3}$/.test(safeNumber)
    || !/^\d{4}$/.test(safePhoneLast4)) {
    return null;
  }

  return {
    tier: safeTier,
    number: safeNumber,
    status: 'approved',
    phoneLast4: safePhoneLast4,
  };
}
