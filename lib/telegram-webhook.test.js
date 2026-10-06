import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasValidTelegramSecret,
  isTelegramAdminUser,
  parseReceiptCallback,
} from './telegram-webhook.js';

test('compares Telegram webhook secret tokens safely', () => {
  assert.equal(hasValidTelegramSecret('secret-token', 'secret-token'), true);
  assert.equal(hasValidTelegramSecret('wrong-token', 'secret-token'), false);
  assert.equal(hasValidTelegramSecret('short', 'secret-token'), false);
  assert.equal(hasValidTelegramSecret('secret-token', ''), false);
});

test('parses only valid receipt review callbacks', () => {
  assert.deepEqual(parseReceiptCallback('approve:entry_123'), {
    status: 'approved',
    entryId: 'entry_123',
  });
  assert.deepEqual(parseReceiptCallback('reject:entry-123'), {
    status: 'rejected',
    entryId: 'entry-123',
  });
  assert.equal(parseReceiptCallback('approve:bad/id'), null);
  assert.equal(parseReceiptCallback('delete:entry-123'), null);
});

test('accepts callbacks only from the configured numeric Telegram user ID', () => {
  assert.equal(isTelegramAdminUser(123456, '123456'), true);
  assert.equal(isTelegramAdminUser(123457, '123456'), false);
  assert.equal(isTelegramAdminUser(undefined, '123456'), false);
  assert.equal(isTelegramAdminUser(123456, ''), false);
});
