import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth, db, paymentConfig } from '../firebaseConfig';
import { Timestamp, collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { apiBaseUrl, uploadReceiptImage } from '../cloudinaryUpload';
import { translations, translate } from '../translations';
import { MAX_TICKET_NUMBER } from '../../lib/ticket-constants';

const TIERS = [
  { amount: 50, icon: '◈', label: 'starter', art: '#34d6f4' },
  { amount: 100, icon: '◇', label: 'classic', art: '#4ade80' },
  { amount: 200, icon: '✦', label: 'premium', art: '#fb923c' },
  { amount: 500, icon: '✹', label: 'grand', art: '#c084fc' },
];
const DEFAULT_PRIZES = Object.fromEntries(TIERS.map(({ amount }) => [amount, { first: 0, second: 0, third: 0 }]));

const requestWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

export default function LotteryRegistration({ user, language }) {
  const t = translations[language] || translations.en;
  const [step, setStep] = useState('categories');
  const [selectedTier, setSelectedTier] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [fullName, setFullName] = useState(user.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentReservation, setCurrentReservation] = useState(null);
  const [successNumber, setSuccessNumber] = useState(null);
  const [ticketQueryAfter, setTicketQueryAfter] = useState(Date.now() + 5000);
  const [reservationsLoading, setReservationsLoading] = useState(true);
  const [receiptFile, setReceiptFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');
  const [prizeAmounts, setPrizeAmounts] = useState(DEFAULT_PRIZES);
  const [paymentDetails, setPaymentDetails] = useState(paymentConfig);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'users', user.uid));
        if (snapshot.exists()) {
          setFullName(snapshot.data().fullName || user.displayName || '');
          setPhoneNumber(snapshot.data().phone || '');
        }
      } catch (profileError) {
        console.error('User profile load error:', profileError);
      }
    };
    loadProfile();
  }, [user.uid, user.displayName]);

  useEffect(() => {
    const interval = setInterval(() => setTicketQueryAfter(Date.now() + 5000), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadPrizes = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'settings', 'prizes'));
        if (snapshot.exists()) {
          setPrizeAmounts({ ...DEFAULT_PRIZES, ...snapshot.data().prizeAmounts });
        }
      } catch (prizeError) {
        console.error('Prize settings error:', prizeError);
      }
    };

    loadPrizes();
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'payment'), (snapshot) => {
      if (snapshot.exists()) {
        setPaymentDetails({ ...paymentConfig, ...snapshot.data() });
      }
    }, (paymentError) => {
      console.error('Payment settings error:', paymentError);
    });
  }, []);

  useEffect(() => {
    if (!selectedTier) {
      setReservations([]);
      setReservationsLoading(false);
      return undefined;
    }

    let activeReservations = [];
    let confirmedReservations = [];
    let ownerReservations = new Map();
    let activeLoaded = false;
    let confirmedLoaded = false;
    let ownerLoaded = false;
    setReservationsLoading(true);

    const updateReservations = () => {
      setReservations(
        [...activeReservations, ...confirmedReservations].map((item) => ({
          ...item,
          phone: ownerReservations.get(item.id)?.phone,
        })),
      );
      if (activeLoaded && confirmedLoaded && ownerLoaded) setReservationsLoading(false);
    };
    const handleListError = (listError) => {
      console.error('Ticket list error:', listError);
      setError(t.entriesLoadError);
      setReservationsLoading(false);
    };

    const unsubscribeActive = onSnapshot(
      query(
        collection(db, 'ticketBoard'),
        where('tier', '==', String(selectedTier)),
        where('status', 'in', ['reserved', 'pending', 'rejected']),
        where('expiresAt', '>', Timestamp.fromMillis(ticketQueryAfter)),
      ),
      (snapshot) => {
        activeReservations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        activeLoaded = true;
        updateReservations();
      },
      handleListError,
    );
    const unsubscribeConfirmed = onSnapshot(
      query(
        collection(db, 'ticketBoard'),
        where('tier', '==', String(selectedTier)),
        where('status', '==', 'approved'),
      ),
      (snapshot) => {
        confirmedReservations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        confirmedLoaded = true;
        updateReservations();
      },
      handleListError,
    );
    const unsubscribeOwnerReservations = onSnapshot(
      query(
        collection(db, 'ticketReservations'),
        where('tier', '==', String(selectedTier)),
        where('ownerUid', '==', user.uid),
      ),
      (snapshot) => {
        ownerReservations = new Map(snapshot.docs.map((item) => [item.id, item.data()]));
        ownerLoaded = true;
        updateReservations();
      },
      handleListError,
    );
    return () => {
      unsubscribeActive();
      unsubscribeConfirmed();
      unsubscribeOwnerReservations();
    };
  }, [selectedTier, t.entriesLoadError, ticketQueryAfter, user.uid]);

  useEffect(() => {
    if (!currentReservation) return undefined;

    const expireReservation = () => {
      setCurrentReservation(null);
      setStep('numbers');
      setError(t.expiredMessage);
    };
    const remaining = currentReservation.expiresAt.toMillis() - Date.now();
    if (remaining <= 0) {
      expireReservation();
      return undefined;
    }

    const timeout = setTimeout(expireReservation, remaining);
    return () => clearTimeout(timeout);
  }, [currentReservation, t.expiredMessage]);

  const chooseTier = (tier) => {
    setSelectedTier(tier);
    setCurrentReservation(null);
    setStep('numbers');
    setError('');
  };

  const reserveNumber = async (number) => {
    if (!fullName.trim() || !phoneNumber.trim()) {
      setError(t.nameBeforeNumber);
      return;
    }

    if (!auth?.currentUser) {
      setError(t.signInRequired);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch(`${apiBaseUrl}/api/reserve-ticket`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tier: selectedTier, number, fullName: fullName.trim(), phone: phoneNumber.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.code || 'ticket-reservation-failed');
      }
      const expiresAt = Timestamp.fromMillis(result.expiresAt);
      const reservation = {
        id: result.reservationId,
        tier: result.tier,
        number: result.number,
        fullName: fullName.trim(),
        phone: phoneNumber.trim(),
        status: 'reserved',
        expiresAt,
      };
      setCurrentReservation(reservation);
      setStep('payment');
    } catch (reserveError) {
      console.error('Ticket reservation error:', reserveError);
      setError(reserveError.message === 'TICKET_TAKEN' ? t.numberTaken : t.genericError);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setError(t.invalidImage);
    if (file.size > 5 * 1024 * 1024) return setError(t.largeImage);
    setError('');
    setReceiptFile(file);
    setFilePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!auth || !db) {
      setError(t.firebaseNotReady);
      return;
    }
    if (!auth.currentUser) {
      setError(t.signInRequired);
      return;
    }
    if (!selectedTier) {
      setError(t.chooseCategoryError);
      return;
    }
    if (!currentReservation || currentReservation.expiresAt.toMillis() <= Date.now()) {
      setError(t.expiredMessage);
      setCurrentReservation(null);
      setStep('numbers');
      return;
    }
    if (!fullName.trim() || !phoneNumber.trim()) return setError(t.enterNamePhone);
    if (!receiptFile) return setError(t.addReceipt);

    setLoading(true);
    setError('');
    setUploadProgress(0);

    try {
      const receiptUrl = await uploadReceiptImage(receiptFile, setUploadProgress);
      const idToken = await auth.currentUser.getIdToken();
      const submissionResponse = await fetch(`${apiBaseUrl}/api/submit-receipt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reservationId: currentReservation.id, receiptUrl }),
      });
      const submission = await submissionResponse.json().catch(() => ({}));
      if (!submissionResponse.ok) {
        throw new Error(submission.code || 'receipt-submission-failed');
      }

      if (auth.currentUser) {
        try {
          const notificationResponse = await requestWithTimeout(`${apiBaseUrl}/api/notify-receipt`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ entryId: submission.entryId }),
          }, 5000);

          if (!notificationResponse.ok) {
            console.warn('Receipt saved, but Telegram notification was not sent.');
          }
        } catch (notifyError) {
          console.warn('Receipt saved, but Telegram notification request timed out or failed.', notifyError);
        }
      }

      setReceiptFile(null);
      setFilePreview(null);
      setSuccessNumber(currentReservation.number);
      setCurrentReservation(null);
      setIsSuccess(true);
    } catch (submitError) {
      console.error(submitError);
      if (submitError.message === 'RESERVATION_EXPIRED') {
        setCurrentReservation(null);
        setStep('numbers');
        setError(t.expiredMessage);
      } else {
        setError(t.genericError);
      }
    } finally {
      setLoading(false);
    }
  };

  if (isSuccess) return <SuccessMessage amount={selectedTier} number={successNumber} t={t} onReset={() => {
    setIsSuccess(false);
    setStep('categories');
    setSelectedTier(null);
    setSuccessNumber(null);
    setReceiptFile(null);
    setFilePreview(null);
    setUploadProgress(0);
  }} />;

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">{t.welcome}، {fullName || user.email}</p><h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">{step === 'categories' ? t.chooseCategory : t.ticketNumber}</h1><p className="mt-2 text-slate-500">{step === 'categories' ? t.categoryIntro : t.ticketPrompt}</p></div>
        {step === 'categories' && <Link to="/wheel" className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-cyan-500 hover:text-cyan-700">{t.viewLottery}</Link>}
        {step !== 'categories' && <button onClick={() => { setCurrentReservation(null); setStep(step === 'numbers' ? 'categories' : 'numbers'); }} className="text-sm font-bold text-slate-600 underline underline-offset-4">{step === 'numbers' ? t.changeCategory : t.changeNumber}</button>}
      </div>
      {error && <p className="mb-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {step === 'categories' && <CategoryGrid onChoose={chooseTier} prizeAmounts={prizeAmounts} t={t} />}
      {step === 'numbers' && <>
        <RegisteredList amount={selectedTier} reservations={reservations} loading={reservationsLoading} userId={user.uid} t={t} />
        <TicketPicker
          fullName={fullName}
          setFullName={setFullName}
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          reservations={reservations}
          loading={loading}
          onChoose={reserveNumber}
          t={t}
        />
      </>}
      {step === 'payment' && currentReservation && <PaymentPanel amount={selectedTier} reservation={currentReservation} paymentDetails={paymentDetails} onDone={() => setStep('upload')} t={t} />}
      {step === 'upload' && <ReceiptForm handleFileChange={handleFileChange} filePreview={filePreview} handleSubmit={handleSubmit} loading={loading} uploadProgress={uploadProgress} number={currentReservation?.number} t={t} />}
    </section>
  );
}

function CategoryGrid({ onChoose, prizeAmounts, t }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{TIERS.map((tier) => <button key={tier.amount} onClick={() => onChoose(tier.amount)} className="group overflow-hidden rounded-[1.75rem] bg-white text-left shadow-lg shadow-slate-900/5 transition hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan-400"><CategoryArt tier={tier} /><div className="p-5"><p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t[tier.label]}</p><p className="mt-1 text-3xl font-black text-slate-950">{tier.amount} <span className="text-base font-bold text-slate-500">{t.birr}</span></p><div className="mt-5 grid grid-cols-3 gap-1 border-t border-slate-100 pt-4 text-center"><PrizeValue label={t.prizeFirst} value={prizeAmounts[tier.amount]?.first} color="text-emerald-600" currency={t.birr} /><PrizeValue label={t.prizeSecond} value={prizeAmounts[tier.amount]?.second} color="text-orange-600" currency={t.birr} /><PrizeValue label={t.prizeThird} value={prizeAmounts[tier.amount]?.third} color="text-cyan-700" currency={t.birr} /></div></div></button>)}</div>;
}

function CategoryArt({ tier }) {
  const gradientId = `category-${tier.amount}`;
  return (
    <div className="relative flex h-44 items-center justify-center overflow-hidden bg-[#071327]">
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `radial-gradient(circle at center, ${tier.art}, transparent 58%)` }} />
      <svg viewBox="0 0 320 176" role="img" aria-label="" className="relative h-full w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={tier.art} />
            <stop offset="1" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <circle cx="160" cy="88" r="59" fill="none" stroke={`url(#${gradientId})`} strokeWidth="2" opacity=".55" />
        <circle cx="160" cy="88" r="44" fill="none" stroke={tier.art} strokeWidth="1" strokeDasharray="3 7" opacity=".8" />
        <path d="M36 88h35l12-17 13 34 15-22h18m63 0h18l14-18 14 36 13-18h33" fill="none" stroke={tier.art} strokeWidth="2" opacity=".72" />
        <path d="M160 38v19m0 62v19m-50-50H91m138 0h-19" stroke="#fff" strokeWidth="1" opacity=".35" />
        <circle cx="160" cy="88" r="28" fill={`url(#${gradientId})`} opacity=".24" />
        <circle cx="160" cy="88" r="20" fill="#0b1830" stroke={tier.art} strokeWidth="2" />
        <text x="160" y="98" textAnchor="middle" fontSize="30" fill="#fff" fontWeight="700">{tier.icon}</text>
        <path d="M47 42h26m-13-13v26m214 82h-24m12-12v24" stroke="#fff" strokeWidth="1" opacity=".36" />
        <circle cx="102" cy="45" r="2" fill={tier.art} /><circle cx="218" cy="132" r="2" fill={tier.art} />
        <circle cx="223" cy="42" r="1.5" fill="#fff" /><circle cx="91" cy="133" r="1.5" fill="#fff" />
      </svg>
      <span className="absolute bottom-3 right-4 rounded-full border border-white/15 bg-slate-950/50 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.25em] text-white/70">ETHIO • {tier.amount}</span>
    </div>
  );
}

function PrizeValue({ label, value, color, currency }) {
  return <div><span className={`block text-[10px] font-black uppercase ${color}`}>{label}</span><span className="mt-1 block text-xs font-bold text-slate-700">{value || 0} {currency}</span></div>;
}

function RegisteredList({ amount, reservations, loading, userId, t }) {
  const now = useCurrentTime(15000);
  const active = reservations
    .filter((item) => item.status === 'approved' || item.expiresAt?.toMillis() > now)
    .sort((left, right) => Number(left.number) - Number(right.number));
  const confirmedCount = active.filter((item) => item.status === 'approved').length;
  const statusLabels = { reserved: t.awaitingPayment, pending: t.underReview, approved: t.confirmed, rejected: t.rejected };

  return (
    <div className="rounded-[1.75rem] bg-slate-950 p-6 text-white shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">{t.category} {amount}</p><h2 className="mt-1 text-2xl font-black">{t.registeredList}</h2></div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{confirmedCount} {t.approvedCount}</span>
      </div>
      <div className="mt-6 max-h-80 space-y-2 overflow-y-auto">
        {loading ? <p className="py-8 text-center text-sm text-slate-400">{t.loadingList}</p>
          : active.length === 0 ? <p className="rounded-2xl border border-white/10 p-5 text-sm text-slate-400">{t.noRegistrations}</p>
            : <>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 px-4 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <span>{t.participant} / {t.ticket}</span>
                <span>{t.mobile}</span>
                <span>{t.status}</span>
              </div>
              {active.map((item) => {
                const remaining = item.expiresAt ? Math.max(0, item.expiresAt.toMillis() - now) : 0;
                const countdown = `${String(Math.floor(remaining / 60000)).padStart(2, '0')}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
                return (
                  <div key={item.id} className="rounded-2xl bg-white/5 px-4 py-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                      <span className="min-w-0"><strong className="mr-2 font-mono text-cyan-300">#{String(item.number).padStart(3, '0')}</strong><span className="font-semibold">{item.fullName}</span></span>
                      <span className="break-all text-xs text-slate-300">{item.ownerUid === userId ? item.phone || item.phoneLast4 : `${t.phoneHidden} ····${item.phoneLast4}`}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${item.status === 'approved' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-300/15 text-amber-200'}`}>{statusLabels[item.status] || t.reserved}</span>
                    </div>
                    {item.status !== 'approved' && <p className="mt-2 text-right text-[10px] text-slate-400">{t.timeRemaining}: {countdown}</p>}
                  </div>
                );
              })}
            </>}
      </div>
    </div>
  );
}

function TicketPicker({ fullName, setFullName, phoneNumber, setPhoneNumber, reservations, loading, onChoose, t }) {
  const now = useCurrentTime(30000);
  const heldNumbers = new Set(reservations
    .filter((item) => item.status === 'approved' || item.expiresAt?.toMillis() > now)
    .map((item) => Number(item.number)));

  return (
    <div className="mt-6 rounded-[1.75rem] bg-white p-6 shadow-xl shadow-slate-900/5">
      <h2 className="text-xl font-black text-slate-950">{t.ticketNumber}</h2>
      <p className="mt-2 text-sm text-slate-500">{t.ticketPrompt}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">{t.fullName}<input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label>
        <label className="text-sm font-bold text-slate-700">{t.mobile}<input required type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder={t.placeholderPhone} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal" /></label>
      </div>
      <p className="mt-5 text-xs font-bold uppercase tracking-wide text-slate-400">{t.available} · #001–#{MAX_TICKET_NUMBER}</p>
      <div className="mt-3 grid max-h-80 grid-cols-5 gap-2 overflow-y-auto p-1 sm:grid-cols-8 md:grid-cols-10">
        {Array.from({ length: MAX_TICKET_NUMBER }, (_, index) => index + 1).map((number) => {
          const unavailable = heldNumbers.has(number);
          return <button key={number} type="button" disabled={unavailable || loading || !fullName.trim() || !phoneNumber.trim()} onClick={() => onChoose(number)} aria-label={`${t.ticket} #${String(number).padStart(3, '0')}`} className={`rounded-lg border px-1 py-2 text-xs font-mono font-bold transition ${unavailable ? 'cursor-not-allowed border-slate-100 bg-slate-100 text-slate-300' : 'border-cyan-100 bg-cyan-50 text-cyan-800 hover:border-cyan-400 hover:bg-cyan-100 disabled:opacity-40'}`}>
            #{String(number).padStart(3, '0')}
          </button>;
        })}
      </div>
    </div>
  );
}

function PaymentPanel({ amount, reservation, paymentDetails, onDone, t }) {
  const now = useCurrentTime(1000);
  const paymentReady = paymentDetails.telebirr || paymentDetails.cbe;
  const remaining = Math.max(0, reservation.expiresAt.toMillis() - now);
  const countdown = `${String(Math.floor(remaining / 60000)).padStart(2, '0')}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`;
  return <div className="rounded-[1.75rem] bg-white p-6 shadow-xl shadow-slate-900/5">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">{t.step} 2 · #{String(reservation.number).padStart(3, '0')}</p>
    <h2 className="mt-2 text-2xl font-black text-slate-950">{t.completePayment}</h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">{t.transferInstructions} <strong className="text-slate-950">{amount} {t.birr}</strong>, {t.thenUpload}</p>
    <p className="mt-2 text-xs font-bold text-orange-700">{t.timeRemaining}: {countdown}</p>
    {paymentReady ? <div className="my-6 space-y-3 rounded-2xl bg-orange-50 p-4 text-sm text-orange-950">{paymentDetails.telebirr && <p><strong>Telebirr</strong><br /><span className="font-mono font-bold">{paymentDetails.telebirr}</span></p>}{paymentDetails.cbe && <p><strong>CBE</strong><br /><span className="font-mono font-bold">{paymentDetails.cbe}</span></p>}</div> : <p className="my-6 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">{t.paymentNotConfigured}</p>}
    <button disabled={!paymentReady} onClick={onDone} className="w-full rounded-2xl bg-orange-500 py-3.5 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">{t.completedPayment}</button>
  </div>;
}

function useCurrentTime(intervalMs) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return now;
}

function ReceiptForm({ handleFileChange, filePreview, handleSubmit, loading, uploadProgress, number, t }) {
  return <form onSubmit={handleSubmit} className="rounded-[1.75rem] bg-white p-6 shadow-xl shadow-slate-900/5">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">{t.step} 3 · #{String(number).padStart(3, '0')}</p>
    <h2 className="mt-2 text-2xl font-black text-slate-950">{t.uploadReceipt}</h2>
    <div className="mt-6 space-y-4">
      <label className="block text-sm font-bold text-slate-700">{t.paymentPhoto}<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="mt-2 block w-full text-sm text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-50 file:px-4 file:py-2.5 file:font-bold file:text-cyan-700" /></label>
      <p className="text-xs text-slate-500">{t.receiptTypes}</p>
      {filePreview && <img src={filePreview} alt={t.paymentPhoto} className="h-40 w-full rounded-2xl border border-slate-100 object-contain" />}
      {loading && <p className="text-sm font-bold text-cyan-700">{translate(t.uploading, { progress: uploadProgress })}</p>}
      <button disabled={loading} className="w-full rounded-2xl bg-slate-950 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">{loading ? t.submitting : t.submitRegistration}</button>
    </div>
  </form>;
}

function SuccessMessage({ amount, number, t, onReset }) {
  return <div className="mx-auto max-w-md rounded-[1.75rem] bg-white p-8 text-center shadow-xl">
    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-black text-emerald-600">✓</div>
    <h2 className="mt-5 text-2xl font-black text-slate-950">{t.receiptReceived}</h2>
    <p className="mt-2 font-mono text-xl font-black text-cyan-700">#{String(number).padStart(3, '0')}</p>
    <p className="mt-2 text-sm leading-6 text-slate-500">{translate(t.pendingVerification, { amount, number })}</p>
    <button onClick={onReset} className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">{t.chooseAnother}</button>
  </div>;
}
