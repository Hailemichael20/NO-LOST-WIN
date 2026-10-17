import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth, db, paymentConfig } from '../firebaseConfig';
import { Timestamp, collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
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

const requestWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
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
  const [notificationFailed, setNotificationFailed] = useState(false);
  const [error, setError] = useState('');
  const [prizeAmounts, setPrizeAmounts] = useState(DEFAULT_PRIZES);
  const [paymentDetails, setPaymentDetails] = useState(paymentConfig);
  const [drawSchedule, setDrawSchedule] = useState({});
  const [latestDraws, setLatestDraws] = useState({});
  const [activeRounds, setActiveRounds] = useState({});
  const [drawScheduleError, setDrawScheduleError] = useState('');
  const [drawEventsError, setDrawEventsError] = useState('');
  const [drawRoundsError, setDrawRoundsError] = useState('');
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState(0);
  const [serverTimeError, setServerTimeError] = useState(false);

  useEffect(() => onSnapshot(collection(db, 'drawSchedule'), (snapshot) => {
    const nextSchedule = {};
    snapshot.docs.forEach((scheduleDoc) => {
      const drawAt = scheduleDoc.data().drawAt;
      if (drawAt?.toDate) nextSchedule[scheduleDoc.id] = drawAt;
    });
    setDrawSchedule(nextSchedule);
    setDrawScheduleError('');
  }, (scheduleError) => {
    console.error('Draw schedule listener error:', scheduleError);
    setDrawScheduleError(t.drawScheduleLoadError);
  }), [t.drawScheduleLoadError]);

  useEffect(() => {
    const erroredTiers = new Set();
    const unsubscribers = TIERS.map(({ amount }) => {
      const latestDrawQuery = query(
        collection(db, 'drawEvents'),
        where('tier', '==', amount),
        orderBy('createdAt', 'desc'),
        limit(1),
      );
      return onSnapshot(latestDrawQuery, (snapshot) => {
        const drawDoc = snapshot.docs[0];
        setLatestDraws((current) => ({
          ...current,
          [amount]: drawDoc ? { id: drawDoc.id, ...drawDoc.data() } : null,
        }));
        erroredTiers.delete(amount);
        if (erroredTiers.size === 0) setDrawEventsError('');
      }, (drawError) => {
        console.error('Draw event listener error:', drawError);
        erroredTiers.add(amount);
        setDrawEventsError(t.drawEventsLoadError);
      });
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [t.drawEventsLoadError]);

  useEffect(() => {
    const unsubscribers = TIERS.map(({ amount }) => onSnapshot(
      doc(db, 'drawRounds', String(amount)),
      (snapshot) => {
        setActiveRounds((current) => ({
          ...current,
          [amount]: snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null,
        }));
        setDrawRoundsError('');
      },
      (roundError) => {
        console.error('Draw round listener error:', roundError);
        setDrawRoundsError(t.drawRoundsLoadError);
      },
    ));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [t.drawRoundsLoadError]);

  useEffect(() => {
    let active = true;
    const syncServerTime = async () => {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${apiBaseUrl}/api/server-time`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !Number.isFinite(result.serverNow)) {
          throw new Error(result.error || 'Server time response was invalid.');
        }
        const receivedAt = Date.now();
        if (active) {
          setServerTimeOffsetMs(result.serverNow - (startedAt + receivedAt) / 2);
          setServerTimeError(false);
        }
      } catch (error) {
        console.error('Server clock sync error:', error);
        if (active) setServerTimeError(true);
      }
    };
    syncServerTime();
    const interval = setInterval(syncServerTime, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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
    setError('');

    const updateReservations = () => {
      const mergedMap = new Map();
      [...activeReservations, ...confirmedReservations].forEach((item) => {
        const ownerReservation = ownerReservations.get(item.id);
        const numberKey = String(item.number);
        const existing = mergedMap.get(numberKey);
        
        // Prioritize approved records over pending/reserved ones for the same number slot
        if (!existing || item.status === 'approved') {
          mergedMap.set(numberKey, {
            ...item,
            ownerUid: ownerReservation ? user.uid : item.ownerUid,
            fullName: ownerReservation?.fullName || item.fullName || '',
            phone: ownerReservation?.phone,
          });
        }
      });
      setReservations(Array.from(mergedMap.values()));
      if (activeLoaded && confirmedLoaded && ownerLoaded) setReservationsLoading(false);
    };

    const handleListError = (listError) => {
      console.error('Ticket list error:', listError);
      setError(t.entriesLoadError);
      setReservationsLoading(false);
    };

    // Query 1: ticketBoard for active/pending reservations
    const unsubscribeActive = onSnapshot(
      query(
        collection(db, 'ticketBoard'),
        where('tier', '==', String(selectedTier)),
      ),
      (snapshot) => {
        activeReservations = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((item) => item.status === 'reserved' || item.status === 'pending' || item.status === 'approved');
        activeLoaded = true;
        updateReservations();
      },
      handleListError,
    );

    // Query 2: entries for approved confirmed tickets
    const unsubscribeConfirmed = onSnapshot(
      query(
        collection(db, 'entries'),
        where('tier', '==', Number(selectedTier)),
        where('status', '==', 'approved'),
      ),
      (snapshot) => {
        confirmedReservations = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        confirmedLoaded = true;
        updateReservations();
      },
      handleListError,
    );

    // Query 3: user's personal reservations
    const unsubscribeOwnerReservations = onSnapshot(
      query(
        collection(db, 'ticketReservations'),
        where('tier', '==', String(selectedTier)),
        where('ownerUid', '==', user.uid),
      ),
      (snapshot) => {
        ownerReservations = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
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
  }, [selectedTier, t.entriesLoadError, user.uid]);

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
    setNotificationFailed(false);
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
          });

          if (!notificationResponse.ok) {
            console.warn('Receipt saved, but Telegram notification was not sent.');
            setNotificationFailed(true);
          }
        } catch (notifyError) {
          console.warn('Receipt saved, but Telegram notification request timed out or failed.', notifyError);
          setNotificationFailed(true);
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

  if (isSuccess) return <SuccessMessage amount={selectedTier} number={successNumber} t={t} notificationFailed={notificationFailed} onReset={() => {
    setIsSuccess(false);
    setNotificationFailed(false);
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
      {step === 'categories' && (drawScheduleError || drawEventsError || drawRoundsError) && (
        <p role="alert" className="mb-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {drawScheduleError || drawEventsError || drawRoundsError}
        </p>
      )}
      {step === 'categories' && serverTimeError && (
        <p role="status" className="mb-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t.serverTimeUnavailable}
        </p>
      )}
      {error && <p className="mb-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {step === 'categories' && (
        <CategoryGrid
          onChoose={chooseTier}
          prizeAmounts={prizeAmounts}
          drawSchedule={drawSchedule}
          latestDraws={latestDraws}
          activeRounds={activeRounds}
          serverTimeOffsetMs={serverTimeOffsetMs}
          language={language}
          t={t}
        />
      )}
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

function CategoryGrid({ onChoose, prizeAmounts, drawSchedule, latestDraws, activeRounds, serverTimeOffsetMs, language, t }) {
  const now = useCurrentTime(1000) + serverTimeOffsetMs;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {TIERS.map((tier) => (
        <button
          key={tier.amount}
          onClick={() => onChoose(tier.amount)}
          className="group overflow-hidden rounded-[1.75rem] bg-white text-left shadow-lg shadow-slate-900/5 transition hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan-400"
        >
          <CategoryArt tier={tier} />
          <div className="p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{t[tier.label]}</p>
            <p className="mt-1 text-3xl font-black text-slate-950">
              {tier.amount} <span className="text-base font-bold text-slate-500">{t.birr}</span>
            </p>
            <DrawResults round={activeRounds[tier.amount]} legacyDraw={latestDraws[tier.amount]} t={t} />
            <DrawTimeInfo
              drawAt={drawSchedule[tier.amount]}
              isDrawComplete={['1', '2', '3'].every((place) => Boolean(activeRounds[tier.amount]?.placements?.[place]))}
              now={now}
              language={language}
              t={t}
            />
            <div className="mt-5 grid grid-cols-3 gap-1 border-t border-slate-100 pt-4 text-center">
              <PrizeValue label={t.prizeFirst} value={prizeAmounts[tier.amount]?.first} color="text-emerald-600" currency={t.birr} />
              <PrizeValue label={t.prizeSecond} value={prizeAmounts[tier.amount]?.second} color="text-orange-600" currency={t.birr} />
              <PrizeValue label={t.prizeThird} value={prizeAmounts[tier.amount]?.third} color="text-cyan-700" currency={t.birr} />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
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
        <circle cx="160" cy="88" r="5