import { FieldValue } from 'firebase-admin/firestore';
import { toPublicEntry } from './public-entry.js';

const TICKET_ID_PATTERN = /^(50|100|200|500)-([0-9]{3})$/;

export async function reviewReceipt(db, entryId, status, reviewedBy, { onlyPending = false } = {}) {
  if (!['approved', 'rejected'].includes(status)) {
    throw new Error('Receipt status is invalid.');
  }

  const entryRef = db.collection('entries').doc(entryId);
  const walletTransactionRef = db.collection('walletTransactions').doc(entryId);

  return db.runTransaction(async (transaction) => {
    const entrySnapshot = await transaction.get(entryRef);
    if (!entrySnapshot.exists) throw new Error('Receipt not found.');

    const entry = entrySnapshot.data();
    if (onlyPending && entry.status !== 'pending') return { alreadyFinal: true };

    if (status === 'rejected') {
      if (entry.status !== 'pending') throw new Error('Only pending receipts can be rejected.');

      let reservationRef;
      let boardRef;
      let publicEntryRef;
      let reservationSnapshot;
      let boardSnapshot;
      if (entry.ticketReservationId) {
        reservationRef = db.collection('ticketReservations').doc(entry.ticketReservationId);
        boardRef = db.collection('ticketBoard').doc(entry.ticketReservationId);
        publicEntryRef = db.collection('publicEntries').doc(entry.ticketReservationId);
        [reservationSnapshot, boardSnapshot] = await Promise.all([
          transaction.get(reservationRef),
          transaction.get(boardRef),
        ]);
      }

      transaction.update(entryRef, {
        status,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy,
      });
      if (reservationSnapshot?.exists
        && reservationSnapshot.data().entryId === entryId
        && boardSnapshot?.exists) {
        transaction.update(reservationRef, { status });
        transaction.update(boardRef, { status });
      }
      if (publicEntryRef) transaction.delete(publicEntryRef);
      return { alreadyFinal: false };
    }

    const amount = Number(entry.tier);
    if (!entry.userId || ![50, 100, 200, 500].includes(amount)) {
      throw new Error('Receipt has invalid wallet data.');
    }

    const existingTransaction = await transaction.get(walletTransactionRef);
    if (existingTransaction.exists) {
      if (entry.status !== 'approved' || entry.walletTransactionId !== walletTransactionRef.id) {
        throw new Error('Receipt wallet state is inconsistent and needs administrator review.');
      }
      return { alreadyProcessed: true, amount };
    }
    if (!['pending', 'rejected'].includes(entry.status)) {
      throw new Error('Only pending or rejected receipts can be approved.');
    }

    let reservationRef;
    let boardRef;
    let publicEntryRef;
    let publicEntry;
    let reservationSnapshot;
    let boardSnapshot;
    if (entry.ticketReservationId) {
      if (!TICKET_ID_PATTERN.test(entry.ticketReservationId)
        || entry.ticketReservationId !== `${entry.ticketTier}-${entry.number}`) {
        throw new Error('Receipt ticket details are invalid.');
      }
      reservationRef = db.collection('ticketReservations').doc(entry.ticketReservationId);
      boardRef = db.collection('ticketBoard').doc(entry.ticketReservationId);
      publicEntryRef = db.collection('publicEntries').doc(entry.ticketReservationId);
      reservationSnapshot = await transaction.get(reservationRef);
      boardSnapshot = await transaction.get(boardRef);
      if (!reservationSnapshot.exists || !boardSnapshot.exists) {
        throw new Error('Ticket reservation is no longer available.');
      }

      const reservation = reservationSnapshot.data();
      const board = boardSnapshot.data();
      const expiresAt = reservation.expiresAt?.toMillis();
      if (reservation.ownerUid !== entry.userId
        || reservation.status !== entry.status
        || reservation.entryId !== entryId
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()
        || reservation.tier !== entry.ticketTier
        || reservation.number !== entry.number
        || reservation.expiresAt.toMillis() !== entry.expiresAt?.toMillis()
        || board.ownerUid !== entry.userId
        || board.status !== entry.status
        || board.tier !== entry.ticketTier
        || board.number !== entry.number
        || board.expiresAt?.toMillis() !== expiresAt) {
        throw new Error('The ticket reservation expired before administrator confirmation.');
      }
      publicEntry = toPublicEntry({
        tier: entry.ticketTier,
        number: entry.number,
        status: 'approved',
        phoneLast4: board.phoneLast4,
        phone: entry.phone,
      });
      if (!publicEntry) {
        throw new Error('The approved ticket does not have valid public display data.');
      }
    }

    const userRef = db.collection('users').doc(entry.userId);
    const userSnapshot = await transaction.get(userRef);
    const currentBalance = Number(userSnapshot.data()?.winBirrBalance || 0);
    if (!Number.isFinite(currentBalance) || currentBalance < 0) {
      throw new Error('User wallet balance is invalid.');
    }

    transaction.set(userRef, {
      winBirrBalance: currentBalance + amount,
      walletUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(walletTransactionRef, {
      userId: entry.userId,
      entryId,
      type: 'receipt_credit',
      amount,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: reviewedBy,
    });
    transaction.update(entryRef, {
      status: 'approved',
      approvedAt: FieldValue.serverTimestamp(),
      reviewedAt: FieldValue.serverTimestamp(),
      approvedBy: reviewedBy,
      walletTransactionId: walletTransactionRef.id,
    });
    if (reservationRef && boardRef) {
      transaction.update(reservationRef, { status: 'approved' });
      transaction.update(boardRef, { status: 'approved' });
      transaction.set(publicEntryRef, publicEntry);
    }

    return { alreadyProcessed: false, amount };
  });
}
