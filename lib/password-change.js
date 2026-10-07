export function randomInt(maxExclusive) {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

export function validateNewPassword(password, confirmation) {
  if (password.length < 6) return 'tooWeak';
  if (password !== confirmation) return 'mismatch';
  return null;
}

export function buildTemporaryPassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const pool = upper + lower + digits;
  const chars = [
    upper[randomInt(upper.length)],
    lower[randomInt(lower.length)],
    digits[randomInt(digits.length)],
  ];

  while (chars.length < 10) {
    chars.push(pool[randomInt(pool.length)]);
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }

  return chars.join('');
}

export function passwordChangeErrorKey(errorCode) {
  if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(errorCode)) {
    return 'wrongCurrentPassword';
  }
  if (errorCode === 'auth/weak-password') return 'passwordTooWeak';
  return 'passwordChangeFailed';
}
