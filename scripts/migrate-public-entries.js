import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { toPublicEntry } from '../lib/public-entry.js';

const database = getFirestore(getFirebaseAdminApp());
const approvedTickets = await database.collection('ticketBoard')
  .where('status', '==', 'approved')
  .get();
const publicEntries = new Map();
let skippedEntries = 0;

for (const ticketSnapshot of approvedTickets.docs) {
  const ticket = ticketSnapshot.data();
  const ticketId = ticketSnapshot.id;
  const publicEntry = toPublicEntry({
    tier: ticket.tier,
    number: ticket.number,
    status: ticket.status,
    phoneLast4: ticket.phoneLast4,
  });

  if (!publicEntry || ticketId !== `${ticket.tier}-${ticket.number}`) {
    skippedEntries += 1;
    console.warn(`Skipping approved ticket ${ticketId}: ticket data is incomplete or inconsistent.`);
    continue;
  }
  if (publicEntries.has(ticketId)) {
    throw new Error(`More than one approved receipt references ticket ${ticketId}.`);
  }
  publicEntries.set(ticketId, publicEntry);
}

const currentPublicEntries = await database.collection('publicEntries').get();
const writer = database.bulkWriter();
writer.onWriteError((error) => {
  console.error(`Public entry migration write failed for ${error.documentRef.path}:`, error);
  return error.failedAttempts < 3;
});

for (const [ticketId, publicEntry] of publicEntries) {
  writer.set(database.collection('publicEntries').doc(ticketId), publicEntry);
}
let removedEntries = 0;
for (const publicEntrySnapshot of currentPublicEntries.docs) {
  if (!publicEntries.has(publicEntrySnapshot.id)) {
    writer.delete(publicEntrySnapshot.ref);
    removedEntries += 1;
  }
}

await writer.close();
console.log(
  `Public entries synchronized: ${publicEntries.size} approved ticket(s), `
  + `${removedEntries} stale document(s) removed, ${skippedEntries} invalid receipt(s) skipped.`,
);
