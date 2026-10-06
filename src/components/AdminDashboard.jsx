import React, { useState, useEffect } from 'react';
import { auth, db, paymentConfig } from '../firebaseConfig';
import { apiBaseUrl } from '../cloudinaryUpload';
import { translations } from '../translations';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  orderBy,
  getDoc,
  runTransaction,
  setDoc
} from 'firebase/firestore';

const TIERS = ['all', 50, 100, 200, 500];
const STATUSES = ['pending', 'approved', 'rejected'];
const PRIZE_TIERS = [50, 100, 200, 500];
const DEFAULT_PRIZES = Object.fromEntries(PRIZE_TIERS.map((tier) => [tier, { first: 0, second: 0, third: 0 }]));

export default function AdminDashboard({ language }) {
  const t = translations[language] || translations.en;
  const [entries, setEntries] = useState([]);
  const [entriesError, setEntriesError] = useState('');
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [tierFilter, setTierFilter] = useState('all');
  const [activeReceiptUrl, setActiveReceiptUrl] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [prizeAmounts, setPrizeAmounts] = useState(DEFAULT_PRIZES);
  const [prizesLoading, setPrizesLoading] = useState(true);
  const [prizesSaving, setPrizesSaving] = useState(false);
  const [prizesMessage, setPrizesMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [paymentDetails, setPaymentDetails] = useState(paymentConfig);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [announcement, setAnnouncement] = useState({ titleEn: '', bodyEn: '', titleAm: '', bodyAm: '' });
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const visibleEntries = entries.filter((entry) => (
    entry.status === 'approved'
    || !entry.expiresAt?.toMillis
    || entry.expiresAt.toMillis() > now
  ));

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadPrizes = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'settings', 'prizes'));
        if (snapshot.exists()) {
          setPrizeAmounts({ ...DEFAULT_PRIZES, ...snapshot.data().prizeAmounts });
        }
      } catch (error) {
        console.error('Prize settings error:', error);
      } finally {
        setPrizesLoading(false);
      }
    };

    loadPrizes();
  }, []);

  useEffect(() => {
    const loadAnnouncement = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'settings', 'announcement'));
        if (snapshot.exists()) {
          setAnnouncement((current) => ({ ...current, ...snapshot.data() }));
        }
      } catch (error) {
        console.error('Announcement settings error:', error);
        setAnnouncementMessage(t.saveFailed);
      }
    };

    loadAnnouncement();
  }, [t.saveFailed]);

  useEffect(() => {
    const loadPaymentDetails = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'settings', 'payment'));
        if (snapshot.exists()) {
          setPaymentDetails({ ...paymentConfig, ...snapshot.data() });
        }
      } catch (error) {
        console.error('Payment settings error:', error);
        setPaymentMessage(t.paymentLoadFailed);
      } finally {
        setPaymentLoading(false);
      }
    };

    loadPaymentDetails();
  }, []);

  const updatePrize = (tier, place, value) => {
    setPrizeAmounts((current) => ({
      ...current,
      [tier]: { ...current[tier], [place]: value },
    }));
  };

  const savePrizes = async (event) => {
    event.preventDefault();
    setPrizesSaving(true);
    setPrizesMessage('');
    try {
      await setDoc(doc(db, 'settings', 'prizes'), {
        prizeAmounts,
        updatedAt: new Date(),
      });
      setPrizesMessage(t.prizesSaved);
    } catch (error) {
      console.error('Prize settings save error:', error);
      setPrizesMessage(t.saveFailed);
    } finally {
      setPrizesSaving(false);
    }
  };

  const savePaymentDetails = async (event) => {
    event.preventDefault();
    setPaymentSaving(true);
    setPaymentMessage('');
    try {
      await setDoc(doc(db, 'settings', 'payment'), {
        telebirr: paymentDetails.telebirr.trim(),
        cbe: paymentDetails.cbe.trim(),
        updatedAt: new Date(),
      });
      setPaymentMessage(t.paymentSaved);
    } catch (error) {
      console.error('Payment settings save error:', error);
      setPaymentMessage(t.saveFailed);
    } finally {
      setPaymentSaving(false);
    }
  };

  const saveAnnouncement = async (event) => {
    event.preventDefault();
    setAnnouncementSaving(true);
    setAnnouncementMessage('');
    try {
      await setDoc(doc(db, 'settings', 'announcement'), {
        ...announcement,
        published: true,
        updatedAt: new Date(),
      });
      setAnnouncementMessage(t.announcementSaved);
    } catch (error) {
      console.error('Announcement save error:', error);
      setAnnouncementMessage(t.saveFailed);
    } finally {
      setAnnouncementSaving(false);
    }
  };

  // 1. Fetch Entries in Real-Time
  useEffect(() => {
    setLoading(true);
    setEntriesError('');
    const constraints = [where('status', '==', statusFilter)];
    if (tierFilter !== 'all') constraints.push(where('tier', '==', Number(tierFilter)));
    constraints.push(orderBy('createdAt', 'desc'));
    const q = query(collection(db, 'entries'), ...constraints);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setEntries(docs);
      setLoading(false);
    }, (error) => {
      console.error('Firestore listener error:', error);
      setEntriesError(t.entriesLoadError);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [statusFilter, tierFilter, t.entriesLoadError]);

  // 2. Approve or Reject Entry Status
  const handleUpdateStatus = async (id, newStatus) => {
    setUpdatingId(id);
    setActionMessage('');
    try {
      if (newStatus === 'approved') {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch(`${apiBaseUrl}/api/approve-receipt`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId: id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Receipt approval failed.');
        setActionMessage(t.receiptApproved.replace('{{amount}}', String(result.amount)));
      } else {
        const entryRef = doc(db, 'entries', id);
        await runTransaction(db, async (transaction) => {
          const entrySnapshot = await transaction.get(entryRef);
          if (!entrySnapshot.exists()) throw new Error('Entry not found.');
          const entry = entrySnapshot.data();
          let reservationRef;
          let boardRef;
          let reservationSnapshot;
          let boardSnapshot;
          if (entry.ticketReservationId) {
            reservationRef = doc(db, 'ticketReservations', entry.ticketReservationId);
            boardRef = doc(db, 'ticketBoard', entry.ticketReservationId);
            [reservationSnapshot, boardSnapshot] = await Promise.all([
              transaction.get(reservationRef),
              transaction.get(boardRef),
            ]);
          }
          transaction.update(entryRef, { status: newStatus, reviewedAt: new Date() });
          if (reservationRef
            && boardRef
            && reservationSnapshot?.exists()
            && reservationSnapshot.data().entryId === id
            && boardSnapshot?.exists()) {
            transaction.update(reservationRef, { status: newStatus });
            transaction.update(boardRef, { status: newStatus });
          }
        });
        setActionMessage(t.receiptRejected);
      }
    } catch (err) {
      console.error(`Failed to update status to ${newStatus}:`, err);
      setActionMessage(err.message === 'Entry not found.' ? t.genericError : t.saveFailed);
    } finally {
      setUpdatingId(null);
    }
  };

  // 3. Delete Entry
  const handleDelete = async (id) => {
    if (!window.confirm(t.deleteConfirm)) return;
    try {
      const entryRef = doc(db, 'entries', id);
      await runTransaction(db, async (transaction) => {
        const entrySnapshot = await transaction.get(entryRef);
        if (!entrySnapshot.exists()) return;
        const entry = entrySnapshot.data();
        let reservationRef;
        let boardRef;
        if (entry.ticketReservationId) {
          reservationRef = doc(db, 'ticketReservations', entry.ticketReservationId);
          boardRef = doc(db, 'ticketBoard', entry.ticketReservationId);
          const reservationSnapshot = await transaction.get(reservationRef);
          const boardSnapshot = await transaction.get(boardRef);
          if (reservationSnapshot.exists() && reservationSnapshot.data().entryId === id) {
            transaction.delete(reservationRef);
            if (boardSnapshot.exists()) transaction.delete(boardRef);
          }
        }
        transaction.delete(entryRef);
      });
    } catch (err) {
      console.error("Failed to delete record:", err);
      setActionMessage(t.genericError);
    }
  };

  return (
    <div className="mx-auto my-4 max-w-6xl rounded-3xl border border-gray-200 bg-slate-50 p-3 sm:my-8 sm:p-6">
      {/* Header & Quick Stats */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t.adminTitle}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.adminSubtitle}</p>
        </div>
        
        <div className="flex gap-3">
          <div className="bg-white px-4 py-2.5 rounded-2xl border border-gray-200 shadow-sm text-center">
            <span className="block text-xs uppercase font-bold text-gray-400">{t.viewingPool}</span>
            <span className="text-xl font-extrabold text-blue-600">{visibleEntries.length} {t.entries}</span>
          </div>
        </div>
      </div>

      {actionMessage && <p className="mb-5 rounded-2xl bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-800">{actionMessage}</p>}

      {/* Control Toolbar (Status & Tier Filters) */}
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:justify-between sm:p-4">
        {/* Status Tabs */}
        <div className="flex w-full flex-wrap rounded-xl bg-gray-100 p-1 sm:w-auto">
          {STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold capitalize transition sm:flex-none sm:px-4 ${
                statusFilter === status
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {t[status] || status}
            </button>
          ))}
        </div>

        {/* Tier Filter dropdown */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="text-xs font-bold uppercase text-gray-500">{t.tier}:</label>
          <div className="flex max-w-full flex-wrap gap-1.5">
            {TIERS.map((tier) => (
              <button
                key={tier}
                onClick={() => setTierFilter(tier)}
                className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold transition sm:px-3 ${
                  tierFilter === tier
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tier === 'all' ? t.all : `${tier} ${t.birr}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={savePrizes} className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-black text-gray-900">{t.winnerPrizes}</h2>
            <p className="mt-1 text-xs text-gray-500">{t.prizeSetup}</p>
          </div>
          <button disabled={prizesLoading || prizesSaving} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-50">
            {prizesSaving ? t.saving : t.savePrizes}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRIZE_TIERS.map((tier) => (
            <div key={tier} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p className="mb-3 text-sm font-black text-gray-900">{tier} {t.birr} {t.category}</p>
              {['first', 'second', 'third'].map((place) => (
                <label key={place} className="mb-2 flex items-center justify-between gap-2 text-xs font-bold capitalize text-gray-500">
                  {t[place]} {t.win}
                  <input type="number" min="0" required value={prizeAmounts[tier]?.[place] ?? 0} onChange={(event) => updatePrize(tier, place, Number(event.target.value))} className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-right text-sm font-bold text-gray-900 outline-none focus:border-cyan-500" />
                </label>
              ))}
            </div>
          ))}
        </div>
        {prizesMessage && <p className="mt-3 text-xs font-semibold text-cyan-700">{prizesMessage}</p>}
      </form>

      <form onSubmit={savePaymentDetails} className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-black text-gray-900">{t.paymentAccounts}</h2>
            <p className="mt-1 text-xs text-gray-500">{t.sharedOnDevices}</p>
          </div>
          <button disabled={paymentLoading || paymentSaving} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-50">
            {paymentSaving ? t.saving : t.savePayment}
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold text-gray-500">
            {t.telebirrPhone}
            <input
              type="text"
              value={paymentDetails.telebirr}
              onChange={(event) => setPaymentDetails((current) => ({ ...current, telebirr: event.target.value }))}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-cyan-500"
            />
          </label>
          <label className="text-xs font-bold text-gray-500">
            {t.cbeAccount}
            <input
              type="text"
              value={paymentDetails.cbe}
              onChange={(event) => setPaymentDetails((current) => ({ ...current, cbe: event.target.value }))}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:border-cyan-500"
            />
          </label>
        </div>
        {paymentMessage && <p className="mt-3 text-xs font-semibold text-cyan-700">{paymentMessage}</p>}
      </form>

      <form onSubmit={saveAnnouncement} className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-black text-gray-900">{t.announcementTitle}</h2>
            <p className="mt-1 text-xs text-gray-500">{t.announcementHelp}</p>
          </div>
          <button disabled={announcementSaving} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-50">
            {announcementSaving ? t.saving : t.publish}
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold text-gray-500">
            {t.announcementTitleEn}
            <input required value={announcement.titleEn} onChange={(event) => setAnnouncement((current) => ({ ...current, titleEn: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" />
          </label>
          <label className="text-xs font-bold text-gray-500">
            {t.announcementTitleAm}
            <input required value={announcement.titleAm} onChange={(event) => setAnnouncement((current) => ({ ...current, titleAm: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" />
          </label>
          <label className="text-xs font-bold text-gray-500">
            {t.announcementBodyEn}
            <textarea required rows="3" value={announcement.bodyEn} onChange={(event) => setAnnouncement((current) => ({ ...current, bodyEn: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" />
          </label>
          <label className="text-xs font-bold text-gray-500">
            {t.announcementBodyAm}
            <textarea required rows="3" value={announcement.bodyAm} onChange={(event) => setAnnouncement((current) => ({ ...current, bodyAm: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900" />
          </label>
        </div>
        {announcementMessage && <p className="mt-3 text-xs font-semibold text-cyan-700">{announcementMessage}</p>}
      </form>

      {entriesError && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{entriesError}</p>}

      {/* Data Table / List */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse font-medium">{t.loadingSubmissions}</div>
      ) : visibleEntries.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 text-gray-400">
          {t.noEntries.replace('{{status}}', t[statusFilter] || statusFilter)}
        </div>
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {visibleEntries.map((entry) => (
            <article key={entry.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words font-bold text-gray-900">{entry.fullName}</h2>
                  <p className="mt-1 break-all font-mono text-xs text-gray-500">{entry.phone}</p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">
                  {t[entry.status] || entry.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                <span className="font-mono font-bold text-gray-900">{entry.number ? `#${String(entry.number).padStart(3, '0')}` : '—'}</span>
                <span>{entry.tier} {t.birr}</span>
                <span className="text-xs">{entry.createdAt?.toDate ? entry.createdAt.toDate().toLocaleString(language === 'am' ? 'am-ET' : 'en-US') : t.justNow}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                {entry.receiptUrl ? (
                  <button
                    onClick={() => setActiveReceiptUrl(entry.receiptUrl)}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-blue-700"
                  >
                    {t.view} {t.receiptScreenshot}
                  </button>
                ) : <span className="text-xs text-gray-400">{t.noReceipt}</span>}
                {entry.status !== 'approved' && (
                  <button onClick={() => handleDelete(entry.id)} className="rounded-lg px-3 py-2 text-xs font-bold text-red-600">
                    {t.deleteRecord}
                  </button>
                )}
              </div>
              {statusFilter === 'pending' && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    disabled={updatingId === entry.id}
                    onClick={() => handleUpdateStatus(entry.id, 'approved')}
                    className="min-h-11 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {t.approve}
                  </button>
                  <button
                    disabled={updatingId === entry.id}
                    onClick={() => handleUpdateStatus(entry.id, 'rejected')}
                    className="min-h-11 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600 disabled:opacity-50"
                  >
                    {t.reject}
                  </button>
                </div>
              )}
              {statusFilter === 'rejected' && (
                <button
                  disabled={updatingId === entry.id}
                  onClick={() => handleUpdateStatus(entry.id, 'approved')}
                  className="mt-3 min-h-11 w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50"
                >
                  {t.reapprove}
                </button>
              )}
            </article>
          ))}
        </div>
        <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">{t.participant}</th>
                  <th className="py-3.5 px-4">{t.ticket}</th>
                  <th className="py-3.5 px-4">{t.tier}</th>
                  <th className="py-3.5 px-4">{t.status}</th>
                  <th className="py-3.5 px-4">{t.receiptScreenshot}</th>
                  <th className="py-3.5 px-4">{t.submittedAt}</th>
                  <th className="py-3.5 px-4 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {visibleEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50/80 transition">
                    {/* Participant Details */}
                    <td className="py-4 px-4">
                      <div className="font-bold text-gray-900">{entry.fullName}</div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">{entry.phone}</div>
                    </td>

                    <td className="py-4 px-4 font-mono font-bold">{entry.number ? `#${String(entry.number).padStart(3, '0')}` : '—'}</td>

                    {/* Tier Tag */}
                    <td className="py-4 px-4">
                      <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {entry.tier} {t.birr}
                      </span>
                    </td>

                    <td className="py-4 px-4">{t[entry.status] || entry.status}</td>

                    {/* Receipt Preview Thumbnail */}
                    <td className="py-4 px-4">
                      {entry.receiptUrl ? (
                        <button
                          onClick={() => setActiveReceiptUrl(entry.receiptUrl)}
                          className="relative group w-16 h-12 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 block"
                        >
                          <img 
                            src={entry.receiptUrl} 
                            alt={t.receiptScreenshot}
                            className="w-full h-full object-cover group-hover:scale-105 transition"
                          />
                          <span className="absolute inset-0 bg-black/30 flex items-center justify-center text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition">
                            {t.view}
                          </span>
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 italic">{t.noReceipt}</span>
                      )}
                    </td>

                    {/* Submission Time */}
                    <td className="py-4 px-4 text-xs text-gray-500">
                      {entry.createdAt?.toDate ? entry.createdAt.toDate().toLocaleString(language === 'am' ? 'am-ET' : 'en-US') : t.justNow}
                    </td>

                    {/* Action Buttons */}
                    <td className="py-4 px-4 text-right space-x-2">
                      {statusFilter === 'pending' && (
                        <>
                          <button
                            disabled={updatingId === entry.id}
                            onClick={() => handleUpdateStatus(entry.id, 'approved')}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
                          >
                            {t.approve}
                          </button>
                          <button
                            disabled={updatingId === entry.id}
                            onClick={() => handleUpdateStatus(entry.id, 'rejected')}
                            className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition"
                          >
                            {t.reject}
                          </button>
                        </>
                      )}

                      {statusFilter === 'rejected' && (
                        <button
                          disabled={updatingId === entry.id}
                          onClick={() => handleUpdateStatus(entry.id, 'approved')}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold transition"
                        >
                          {t.reapprove}
                        </button>
                      )}

                      {entry.status !== 'approved' && (
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="px-2 py-1.5 text-gray-400 hover:text-red-600 transition text-xs"
                          title={t.deleteRecord}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* Full Resolution Receipt Image Modal */}
      {activeReceiptUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-4 overflow-hidden relative shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-gray-800 text-sm">{t.receiptVerification}</h3>
              <button
                onClick={() => setActiveReceiptUrl(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto bg-gray-900 rounded-xl flex items-center justify-center p-2">
              <img 
                src={activeReceiptUrl} 
                alt={t.receiptScreenshot}
                className="max-w-full max-h-[65vh] object-contain rounded"
              />
            </div>

            <div className="mt-4 flex justify-between items-center text-xs text-gray-500">
              <span>{t.verifyReceiptTip}</span>
              <a 
                href={activeReceiptUrl} 
                target="_blank" 
                rel="noreferrer" 
                className="text-blue-600 font-bold underline"
              >
                {t.openOriginal}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}