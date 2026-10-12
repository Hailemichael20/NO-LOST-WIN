import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTemporaryPassword, passwordChangeErrorKey, validateNewPassword } from './password-change.js';
import {
  getPasswordChangeRequirementStatus,
  hasPasswordChangedSinceRequirement,
  isPasswordChangeRequired,
  toEpochMillis,
} from './password-change-required.js';

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
  assert.equal(hasPasswordChangedSinceRequirement('2026-10-06T12:00:00.000Z', requiredAt), true);
  assert.equal(hasPasswordChangedSinceRequirement('invalid', requiredAt), false);
  assert.equal(hasPasswordChangedSinceRequirement('2026-10-06T12:00:01.000Z', null), false);
});

test('password timestamps are normalized to milliseconds from supported sources', () => {
  const expected = Date.parse('2026-10-06T12:00:00.000Z');

  assert.equal(toEpochMillis('2026-10-06T12:00:00.000Z'), expected);
  assert.equal(toEpochMillis(new Date(expected)), expected);
  assert.equal(toEpochMillis({ toMillis: () => expected }), expected);
  assert.equal(toEpochMillis(expected), expected);
  assert.equal(toEpochMillis('invalid'), null);
});

test('forced password change is required only when the admin-reset timestamp exists', () => {
  assert.equal(isPasswordChangeRequired({
    mustChangePassword: true,
    passwordChangeRequiredAt: { toMillis: () => 1 },
  }), true);
  assert.equal(isPasswordChangeRequired({ mustChangePassword: true }), false);
  assert.equal(isPasswordChangeRequired({
    mustChangePassword: false,
    passwordChangeRequiredAt: { toMillis: () => 1 },
  }), false);
  assert.equal(isPasswordChangeRequired(null), false);
});

test('password-change flag cleanup is idempotent and only clears after a newer password update', () => {
  const requirement = {
    mustChangePassword: true,
    passwordChangeRequiredAt: { toMillis: () => Date.parse('2026-10-06T12:00:00.000Z') },
  };

  assert.equal(getPasswordChangeRequirementStatus({ mustChangePassword: false }, null), 'cleared');
  assert.equal(getPasswordChangeRequirementStatus(null, null), 'cleared');
  assert.equal(getPasswordChangeRequirementStatus(requirement, '2026-10-06T12:00:01.000Z'), 'cleared');
  assert.equal(getPasswordChangeRequirementStatus(requirement, '2026-10-06T12:00:00.000Z'), 'password-not-changed');
  assert.equal(getPasswordChangeRequirementStatus({ mustChangePassword: true }, null), 'missing-requirement-time');
});

test('temporary passwords are random, 10 characters, and include mixed character classes', () => {
  const password = buildTemporaryPassword();

  assert.equal(password.length, 10);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[0-9]/);
});
