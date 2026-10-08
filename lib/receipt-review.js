import { FieldValue } from 'firebase-admin/firestore';
import { toPublicEntry } from './public-entry.js';

const TICKET_ID_PATTERN = /^(50|100|200|500)-([0-9]{3})$/;

export async function reviewReceipt(db, entryId, status, reviewedBy, { onlyPending = false } = {}) {
  if (!['approved', 'rejected'].includes(status)) {
    throw new Error('Receipt status is invalid.');
  }

  const entryRef = db.collection('entries').doc(entryId);
  const privateEntryRef = db.collection('entryPrivate').doc(entryId);
  const walletTransactionRef = db.collection('walletTransactions').doc(entryId);

  return db.runTransaction(async (transaction) => {
    const [entrySnapshot, privateEntrySnapshot] = await Promise.all([
      transaction.get(entryRef),
      transaction.get(privateEntryRef),
    ]);
    if (!entrySnapshot.exists) throw new Error('Receipt not found.');

    const entry = entrySnapshot.data();
    const privateEntry = privateEntrySnapshot.exists ? privateEntrySnapshot.data() : entry;
    if (onlyPending && entry.status !== 'pending') return { alreadyFinal: true };

    if (status === 'rejected') {
      if (entry.status !== 'pending') throw new Error('Only pending receipts can be rejected.');

      let reservationRef;
      let boardRef;
      let reservationSnapshot;
      let boardSnapshot;
      const ticketReservationId = privateEntry.ticketReservationId || entry.ticketReservationId;
      if (ticketReservationId) {
        reservationRef = db.collection('ticketReservations').doc(ticketReservationId);
        boardRef = db.collection('ticketBoard').doc(ticketReservationId);
        [reservationSnapshot, boardSnapshot] = await Promise.all([
          transaction.get(reservationRef),
          transaction.get(boardRef),
        ]);
      }

      transaction.update(entryRef, {
        status,
      });
      transaction.set(privateEntryRef, {
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy,
      }, { merge: true });
      if (reservationSnapshot?.exists
        && reservationSnapshot.data().entryId === entryId
        && boardSnapshot?.exists) {
        transaction.update(reservationRef, { status });
        transaction.update(boardRef, { status });
      }
      return { alreadyFinal: false };
    }

    const amount = Number(entry.tier);
    if (!privateEntry.userId || ![50, 100, 200, 500].includes(amount)) {
      throw new Error('Receipt has invalid wallet data.');
    }

    const existingTransaction = await transaction.get(walletTransactionRef);
    if (existingTransaction.exists) {
      if (entry.status !== 'approved') {
        throw new Error('Receipt wallet state is inconsistent and needs administrator review.');
      }
      return { alreadyProcessed: true, amount };
    }
    if (!['pending', 'rejected'].includes(entry.status)) {
      throw new Error('Only pending or rejected receipts can be approved.');
    }

    let reservationRef;
    let boardRef;
    let publicEntry;
    let reservationSnapshot;
    let boardSnapshot;
    const ticketReservationId = privateEntry.ticketReservationId || entry.ticketReservationId;
    const ticketTier = privateEntry.ticketTier || privateEntry.tier || entry.tier;
    const ticketNumber = privateEntry.number || entry.number;
    if (ticketReservationId) {
      if (!TICKET_ID_PATTERN.test(ticketReservationId)
        || ticketReservationId !== `${ticketTier}-${ticketNumber}`) {
        throw new Error('Receipt ticket details are invalid.');
      }
      reservationRef = db.collection('ticketReservations').doc(ticketReservationId);
      boardRef = db.collection('ticketBoard').doc(ticketReservationId);
      reservationSnapshot = await transaction.get(reservationRef);
      boardSnapshot = await transaction.get(boardRef);
      if (!reservationSnapshot.exists || !boardSnapshot.exists) {
        throw new Error('Ticket reservation is no longer available.');
      }

      const reservation = reservationSnapshot.data();
      const board = boardSnapshot.data();
      const expiresAt = reservation.expiresAt?.toMillis();
      if (reservation.ownerUid !== privateEntry.userId
        || reservation.status !== entry.status
        || reservation.entryId !== entryId
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()
        || reservation.tier !== String(ticketTier)
        || reservation.number !== ticketNumber
        || reservation.expiresAt.toMillis() !== privateEntry.expiresAt?.toMillis()
        || board.ownerUid !== privateEntry.userId
        || board.status !== entry.status
        || board.tier !== String(ticketTier)
        || board.number !== ticketNumber
        || board.expiresAt?.toMillis() !== expiresAt) {
        throw new Error('The ticket reservation expired before administrator confirmation.');
      }
      publicEntry = toPublicEntry({
        tier: ticketTier,
        number: ticketNumber,
        status: 'approved',
        phoneLast4: privateEntry.phoneLast4 || board.phoneLast4 || privateEntry.phone,
      });
      if (!publicEntry) {
        throw new Error('The approved ticket does not have valid public display data.');
      }
    }

    const userRef = db.collection('users').doc(privateEntry.userId);
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
      userId: privateEntry.userId,
      entryId,
      type: 'receipt_credit',
      amount,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: reviewedBy,
    });
    transaction.update(entryRef, {
      status: 'approved',
      ...(publicEntry || {}),
    });
    transaction.set(privateEntryRef, {
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: reviewedBy,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy,
    }, { merge: true });
    if (reservationRef && boardRef) {
      transaction.update(reservationRef, { status: 'approved' });
      transaction.update(boardRef, { status: 'approved' });
    }

    return { alreadyProcessed: false, amount };
  });
}
