import test from 'node:test';
import assert from 'node:assert/strict';

import { toPublicEntry } from './public-entry.js';

test('public entry contains only approved ticket fields and a masked phone suffix', () => {
  assert.deepEqual(toPublicEntry({
    tier: 100,
    number: '007',
    status: 'approved',
    phone: '+251 912 345 678',
    fullName: 'Private Name',
    receiptUrl: 'https://example.com/private-receipt',
  }), {
    tier: '100',
    number: '007',
    status: 'approved',
    phoneLast4: '5678',
  });
});

test('public entry rejects invalid category, number, status, or phone suffix', () => {
  assert.equal(toPublicEntry({ tier: 10, number: '007', status: 'approved', phone: '12345678' }), null);
  assert.equal(toPublicEntry({ tier: 100, number: '000', status: 'approved', phone: '12345678' }), null);
  assert.equal(toPublicEntry({ tier: 100, number: '007', status: 'pending', phone: '12345678' }), null);
  assert.equal(toPublicEntry({ tier: 100, number: '007', status: 'approved', phone: '123' }), null);
});
