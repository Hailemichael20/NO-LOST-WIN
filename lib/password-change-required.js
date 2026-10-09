export function hasPasswordChangedSinceRequirement(passwordUpdatedAt, requirementTimestamp) {
  const passwordUpdatedAtMillis = Date.parse(passwordUpdatedAt || '');
  const requiredAtMillis = typeof requirementTimestamp?.toMillis === 'function'
    ? requirementTimestamp.toMillis()
    : Date.parse(requirementTimestamp || '');

  return Number.isFinite(passwordUpdatedAtMillis)
    && Number.isFinite(requiredAtMillis)
    && passwordUpdatedAtMillis > requiredAtMillis;
}
