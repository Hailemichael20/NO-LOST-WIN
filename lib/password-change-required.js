export function isPasswordChangeRequired(userData) {
  return userData?.mustChangePassword === true
    && typeof userData.passwordChangeRequiredAt?.toMillis === 'function';
}

export function toEpochMillis(timestamp) {
  if (typeof timestamp === 'number') {
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof timestamp?.toMillis === 'function') {
    const timestampMillis = timestamp.toMillis();
    return Number.isFinite(timestampMillis) ? timestampMillis : null;
  }
  if (timestamp instanceof Date) {
    const timestampMillis = timestamp.getTime();
    return Number.isFinite(timestampMillis) ? timestampMillis : null;
  }
  if (typeof timestamp === 'string' && timestamp) {
    const timestampMillis = Date.parse(timestamp);
    return Number.isFinite(timestampMillis) ? timestampMillis : null;
  }
  return null;
}

export function hasPasswordChangedSinceRequirement(passwordUpdatedAt, requirementTimestamp) {
  const passwordUpdatedAtMillis = toEpochMillis(passwordUpdatedAt);
  const requiredAtMillis = toEpochMillis(requirementTimestamp);

  return passwordUpdatedAtMillis !== null
    && requiredAtMillis !== null
    && passwordUpdatedAtMillis >= requiredAtMillis;
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
