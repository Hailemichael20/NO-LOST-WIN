import test from 'node:test';
import assert from 'node:assert/strict';

import { passwordChangeErrorKey, validateNewPassword } from './password-change.js';

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
