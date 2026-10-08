import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';

const PAGE_SIZE = 500;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

if (args.some((argument) => argument !== '--dry-run') || args.length > 1) {
  console.error('Usage: node scripts/reset-win-balances.js [--dry-run]');
  process.exitCode = 1;
} else {
  let changedCount = 0;

  try {
    const database = getFirestore(getFirebaseAdminApp());
    const users = database.collection('users');
    let cursor = null;

    while (true) {
      const pageQuery = users.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
      const page = cursor
        ? await pageQuery.startAfter(cursor).get()
        : await pageQuery.get();

      if (page.empty) break;

      const changedUsers = page.docs.filter(
        (userSnapshot) => userSnapshot.data().winBirrBalance !== 0,
      );

      if (!dryRun && changedUsers.length > 0) {
        const batch = database.batch();
        changedUsers.forEach((userSnapshot) => {
          batch.update(userSnapshot.ref, { winBirrBalance: 0 });
        });
        await batch.commit();
      }

      changedCount += changedUsers.length;
      cursor = page.docs[page.docs.length - 1];
      if (page.size < PAGE_SIZE) break;
    }

    console.log(dryRun
      ? `Dry run: ${changedCount} user(s) would change.`
      : `Final count: ${changedCount} user(s) updated.`);
  } catch (error) {
    console.error(`Balance reset failed after ${changedCount} user(s):`, error);
    process.exitCode = 1;
  }
}
