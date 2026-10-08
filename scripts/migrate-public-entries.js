import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

const database = getFirestore(getFirebaseAdminApp());
const entries = await database.collection('entries').get();
const approvedBoards = await database.collection('ticketBoard')
  .where('status', '==', 'approved')
  .get();
const privateFields = new Set([
  'userId',
  'email',
  'fullName',
  'phone',
  'ticketTier',
  'expiresAt',
  'receiptUrl',
  'reviewedAt',
  'reviewedBy',
  'approvedAt',
  'approvedBy',
  'walletTransactionId',
  'isWinner',
  'wonAt',
]);
const allowedTiers = new Set([50, 100, 200, 500]);
const writer = database.bulkWriter();
const existingTicketKeys = new Set();
let migratedEntries = 0;
let skippedEntries = 0;
let importedBoardEntries = 0;

function ticketKey(tier, number) {
  return `${Number(tier)}-${String(number).padStart(3, '0')}`;
}

writer.onWriteError((error) => {
  console.error(`Entry migration write failed for ${error.documentRef.path}:`, error);
  return error.failedAttempts < 3;
});

for (const entrySnapshot of entries.docs) {
  const data = entrySnapshot.data();
  const entryRef = entrySnapshot.ref;
  const privateEntryRef = database.collection('entryPrivate').doc(entrySnapshot.id);
  const privateEntry = Object.fromEntries(
    Object.entries(data).filter(([key]) => ![
      'entryId',
      'tier',
      'number',
      'ticketReservationId',
      'phoneLast4',
      'status',
      'createdAt',
    ].includes(key)),
  );
  const tierMatch = /^(50|100|200|500)(?:\s*birr)?$/i.exec(String(data.tier || '').trim());
  const tier = tierMatch ? Number(tierMatch[1]) : Number(data.tier);
  const statusValue = String(data.status || '').toLowerCase();
  const status = ['approved', 'confirmed', 'paid'].includes(statusValue)
    ? 'approved'
    : ['pending', 'rejected'].includes(statusValue)
      ? statusValue
      : null;

  if (!allowedTiers.has(tier) || !status) {
    skippedEntries += 1;
    console.warn(`Skipping ${entrySnapshot.id}: category or status is not recognized.`);
    continue;
  }

  const safeEntry = {
    entryId: entrySnapshot.id,
    tier,
    status,
    createdAt: data.createdAt?.toDate ? data.createdAt : FieldValue.serverTimestamp(),
  };
  const numberMatch = /^#?(\d{1,3})$/.exec(String(data.number || '').trim());
  if (numberMatch) {
    const number = Number(numberMatch[1]);
    if (number >= 1 && number <= 500) {
      safeEntry.number = String(number).padStart(3, '0');
    }
  }
  if (typeof data.ticketReservationId === 'string') {
    safeEntry.ticketReservationId = data.ticketReservationId;
  }
  const phoneLast4 = String(data.phoneLast4 || data.phone || '').replace(/\D/g, '').slice(-4);
  if (/^\d{4}$/.test(phoneLast4)) safeEntry.phoneLast4 = phoneLast4;

  delete privateEntry.status;
  if (Object.keys(privateEntry).length > 0) {
    writer.set(privateEntryRef, privateEntry, { merge: true });
  }
  writer.set(entryRef, safeEntry);
  if (safeEntry.number) existingTicketKeys.add(ticketKey(tier, safeEntry.number));
  migratedEntries += 1;
}

for (const boardSnapshot of approvedBoards.docs) {
  const ticket = boardSnapshot.data();
  const tier = Number(ticket.tier);
  const numberMatch = /^#?(\d{1,3})$/.exec(String(ticket.number || '').trim());
  const number = numberMatch ? Number(numberMatch[1]) : 0;
  const key = ticketKey(tier, number);
  if (!allowedTiers.has(tier) || number < 1 || number > 500 || existingTicketKeys.has(key)) continue;

  const entryId = `legacy-${boardSnapshot.id}`;
  const entryRef = database.collection('entries').doc(entryId);
  const privateEntryRef = database.collection('entryPrivate').doc(entryId);
  const createdAt = ticket.reservedAt?.toDate ? ticket.reservedAt : FieldValue.serverTimestamp();
  const phoneLast4 = String(ticket.phoneLast4 || '').replace(/\D/g, '').slice(-4);
  writer.set(entryRef, {
    entryId,
    tier,
    number: String(number).padStart(3, '0'),
    ticketReservationId: boardSnapshot.id,
    ...(phoneLast4.length === 4 ? { phoneLast4 } : {}),
    status: 'approved',
    createdAt,
  });
  writer.set(privateEntryRef, {
    userId: ticket.ownerUid || '',
    fullName: ticket.fullName || '',
    phoneLast4,
    number: String(number).padStart(3, '0'),
    tier: String(tier),
    ticketReservationId: boardSnapshot.id,
  }, { merge: true });
  existingTicketKeys.add(key);
  importedBoardEntries += 1;
}

const legacyPublicEntries = await database.collection('publicEntries').get();
for (const legacyEntry of legacyPublicEntries.docs) {
  writer.delete(legacyEntry.ref);
}

await writer.close();
console.log(
  `Migrated ${migratedEntries} canonical entries, removed ${legacyPublicEntries.size} old public copies, `
  + `imported ${importedBoardEntries} missing approved tickets, and skipped ${skippedEntries} entries `
  + `with unrecognized status/category.`,
);
