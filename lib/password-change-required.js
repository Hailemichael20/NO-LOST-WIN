export function isPasswordChangeRequired(userData) {
  return userData?.mustChangePassword === true
    && typeof userData.passwordChangeRequiredAt?.toMillis === 'function';
}

export function hasPasswordChangedSinceRequirement(passwordUpdatedAt, requirementTimestamp) {
  const passwordUpdatedAtMillis = Date.parse(passwordUpdatedAt || '');
  const requiredAtMillis = typeof requirementTimestamp?.toMillis === 'function'
    ? requirementTimestamp.toMillis()
    : Date.parse(requirementTimestamp || '');

  return Number.isFinite(passwordUpdatedAtMillis)
    && Number.isFinite(requiredAtMillis)
    && passwordUpdatedAtMillis > requiredAtMillis;
}

export function getPasswordChangeRequirementStatus(userData, passwordUpdatedAt) {
  if (userData?.mustChangePassword !== true) return 'cleared';

  const requirementTimestamp = userData.passwordChangeRequiredPasswordUpdatedAt
    || userData.passwordChangeRequiredAt;
  if (!requirementTimestamp) return 'missing-requirement-time';

  return hasPasswordChangedSinceRequirement(passwordUpdatedAt, requirementTimestamp)
    ? 'cleared'
    : 'password-not-changed';
}
