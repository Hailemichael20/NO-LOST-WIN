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
        delete(reference) {
          documents.delete(reference.path);
        },
      });
    },
    documents,
  };
  return database;
}

test('rejecting a pending receipt updates its status and ignores subsequent reviews', async () => {
  const db = createDatabase({
    'entries/entry-1': { status: 'pending', ticketReservationId: '100-001' },
    'ticketReservations/100-001': { entryId: 'entry-1', status: 'pending' },
    'ticketBoard/100-001': { status: 'pending' },
  });

  assert.deepEqual(await reviewReceipt(db, 'entry-1', 'rejected', 'telegram:123', { onlyPending: true }), {
    alreadyFinal: false,
  });
  assert.equal(db.documents.get('entries/entry-1').status, 'rejected');
  assert.equal(db.documents.get('entryPrivate/entry-1').reviewedBy, 'telegram:123');
  assert.deepEqual(await reviewReceipt(db, 'entry-1', 'approved', 'telegram:123', { onlyPending: true }), {
    alreadyFinal: true,
  });
  assert.equal(db.documents.has('walletTransactions/entry-1'), false);
});

test('approving a pending receipt credits the wallet once and ignores later reviews', async () => {
  const db = createDatabase({
    'entries/entry-2': { status: 'pending', tier: 100 },
    'entryPrivate/entry-2': { userId: 'user-1', fullName: 'A User', phone: '0912345678' },
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

test('approving a ticket updates the canonical entry and keeps personal details private', async () => {
  const expiresAt = { toMillis: () => Date.now() + 60_000 };
  const db = createDatabase({
    'entries/entry-3': {
      status: 'pending',
      tier: 100,
      number: '007',
      ticketReservationId: '100-007',
      createdAt: new Date(),
      phoneLast4: '5678',
    },
    'entryPrivate/entry-3': {
      userId: 'user-3',
      tier: '100',
      number: '007',
      phone: '+251 912 345 678',
      ticketReservationId: '100-007',
      expiresAt,
    },
    'ticketReservations/100-007': {
      ownerUid: 'user-3',
      tier: '100',
      number: '007',
      status: 'pending',
      entryId: 'entry-3',
      expiresAt,
    },
    'ticketBoard/100-007': {
      ownerUid: 'user-3',
      tier: '100',
      number: '007',
      status: 'pending',
      phoneLast4: '5678',
      expiresAt,
    },
    'users/user-3': { winBirrBalance: 0 },
  });

  await reviewReceipt(db, 'entry-3', 'approved', 'admin-1');

  assert.equal(db.documents.get('ticketBoard/100-007').status, 'approved');
  assert.equal(db.documents.get('ticketBoard/100-007').tier, '100');
  assert.equal(db.documents.get('ticketBoard/100-007').number, '007');
  assert.deepEqual(db.documents.get('entries/entry-3'), {
    status: 'approved',
    tier: 100,
    number: '007',
    phoneLast4: '5678',
    ticketReservationId: '100-007',
    createdAt: db.documents.get('entries/entry-3').createdAt,
  });
  assert.equal(db.documents.get('entries/entry-3').userId, undefined);
  assert.equal(db.documents.get('entryPrivate/entry-3').phone, '+251 912 345 678');
});
