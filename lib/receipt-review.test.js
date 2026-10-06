import test from 'node:test';
import assert from 'node:assert/strict';

import { reviewReceipt } from './receipt-review.js';

function createDatabase(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, data]) => [path, { ...data }]));
  const database = {
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return { path };
        },
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(reference) {
          const data = documents.get(reference.path);
          return { exists: Boolean(data), data: () => data };
        },
        update(reference, updates) {
          documents.set(reference.path, { ...documents.get(reference.path), ...updates });
        },
        set(reference, data, options) {
          documents.set(reference.path, options?.merge
            ? { ...documents.get(reference.path), ...data }
            : { ...data });
        },
      });
    },
    documents,
  };
  return database;
}

test('rejecting a pending receipt updates its status and ignores subsequent reviews', async () => {
  const db = createDatabase({
    'entries/entry-1': { status: 'pending' },
  });

  assert.deepEqual(await reviewReceipt(db, 'entry-1', 'rejected', 'telegram:123', { onlyPending: true }), {
    alreadyFinal: false,
  });
  assert.equal(db.documents.get('entries/entry-1').status, 'rejected');
  assert.deepEqual(await reviewReceipt(db, 'entry-1', 'approved', 'telegram:123', { onlyPending: true }), {
    alreadyFinal: true,
  });
  assert.equal(db.documents.has('walletTransactions/entry-1'), false);
});

test('approving a pending receipt credits the wallet once and ignores later reviews', async () => {
  const db = createDatabase({
    'entries/entry-2': { status: 'pending', userId: 'user-1', tier: 100 },
    'users/user-1': { winBirrBalance: 50 },
  });

  assert.deepEqual(await reviewReceipt(db, 'entry-2', 'approved', 'telegram:123', { onlyPending: true }), {
    alreadyProcessed: false,
    amount: 100,
  });
  assert.equal(db.documents.get('entries/entry-2').status, 'approved');
  assert.equal(db.documents.get('users/user-1').winBirrBalance, 150);
  assert.equal(db.documents.get('walletTransactions/entry-2').amount, 100);
  assert.deepEqual(await reviewReceipt(db, 'entry-2', 'approved', 'telegram:123', { onlyPending: true }), {
    alreadyFinal: true,
  });
  assert.equal(db.documents.get('users/user-1').winBirrBalance, 150);
});
