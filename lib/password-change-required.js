export function hasPasswordChangedSinceRequirement(passwordUpdatedAt, requirementTimestamp) {
  const passwordUpdatedAtMillis = Date.parse(passwordUpdatedAt || '');
  const requiredAtMillis = typeof requirementTimestamp?.toMillis === 'function'
    ? requirementTimestamp.toMillis()
    : Number.NaN;

  return Number.isFinite(passwordUpdatedAtMillis)
    && Number.isFinite(requiredAtMillis)
    && passwordUpdatedAtMillis > requiredAtMillis;
}
