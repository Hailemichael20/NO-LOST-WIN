export function validateNewPassword(password, confirmation) {
  if (password.length < 6) return 'tooWeak';
  if (password !== confirmation) return 'mismatch';
  return null;
}

export function passwordChangeErrorKey(errorCode) {
  if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(errorCode)) {
    return 'wrongCurrentPassword';
  }
  if (errorCode === 'auth/weak-password') return 'passwordTooWeak';
  return 'passwordChangeFailed';
}
