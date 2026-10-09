import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTemporaryPassword, passwordChangeErrorKey, validateNewPassword } from './password-change.js';
import { hasPasswordChangedSinceRequirement } from './password-change-required.js';

test('new password must be at least six characters and match confirmation', () => {
  assert.equal(validateNewPassword('abc', 'abc'), 'tooWeak');
  assert.equal(validateNewPassword('abcdef', 'different'), 'mismatch');
  assert.equal(validateNewPassword('abcdef', 'abcdef'), null);
});

test('password change errors identify wrong current and weak passwords', () => {
  assert.equal(passwordChangeErrorKey('auth/wrong-password'), 'wrongCurrentPassword');
  assert.equal(passwordChangeErrorKey('auth/invalid-credential'), 'wrongCurrentPassword');
  assert.equal(passwordChangeErrorKey('auth/weak-password'), 'passwordTooWeak');
  assert.equal(passwordChangeErrorKey('auth/network-request-failed'), 'passwordChangeFailed');
});

test('forced password-change flag clears only for a password update after its baseline', () => {
  const requiredAt = { toMillis: () => Date.parse('2026-10-06T12:00:00.000Z') };

  assert.equal(hasPasswordChangedSinceRequirement('2026-10-06T12:00:01.000Z', requiredAt), true);
  assert.equal(
    hasPasswordChangedSinceRequirement(
      '2026-10-06T12:00:01.000Z',
      '2026-10-06T12:00:00.000Z',
    ),
    true,
  );
  assert.equal(hasPasswordChangedSinceRequirement('2026-10-06T11:59:59.000Z', requiredAt), false);
  assert.equal(
    hasPasswordChangedSinceRequirement(
      '2026-10-06T12:00:00.000Z',
      '2026-10-06T12:00:00.000Z',
    ),
    false,
  );
  assert.equal(hasPasswordChangedSinceRequirement('2026-10-06T12:00:00.000Z', requiredAt), false);
  assert.equal(hasPasswordChangedSinceRequirement('invalid', requiredAt), false);
  assert.equal(hasPasswordChangedSinceRequirement('2026-10-06T12:00:01.000Z', null), false);
});

test('temporary passwords are random, 10 characters, and include mixed character classes', () => {
  const password = buildTemporaryPassword();

  assert.equal(password.length, 10);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[0-9]/);
});
