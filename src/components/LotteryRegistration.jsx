import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, storage } from '../firebaseConfig';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

const TIERS = [
  { amount: 50, icon: '◈', label: 'Starter', color: 'from-cyan-500 to-blue-600' },
  { amount: 100, icon: '◇', label: 'Classic', color: 'from-emerald-500 to-teal-600' },
  { amount: 200, icon: '✦', label: 'Premium', color: 'from-orange-400 to-rose-500' },
  { amount: 500, icon: '✹', label: 'Grand', color: 'from-violet-500 to-fuchsia-600' },
];
const DEFAULT_PRIZES = Object.fromEntries(TIERS.map(({ amount }) => [amount, { first: 0, second: 0, third: 0 }]));

export default function LotteryRegistration({ user }) {
  const [step, setStep] = useState('categories');
  const [selectedTier, setSelectedTier] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [fullName, setFullName] = useState(user.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');
  const [prizeAmounts, setPrizeAmounts] = useState(DEFAULT_PRIZES);

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

  const chooseTier = async (tier) => {
    setSelectedTier(tier);
    setStep('registered');
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDocs(query(collection(db, 'entries'), where('tier', '==', tier), where('status', '==', 'approved')));
      setParticipants(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    } catch (fetchError) {
      console.error(fetchError);
      setError('The registered list could not be loaded. You can still continue with payment.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Please upload a JPG or PNG image.');
    if (file.size > 5 * 1024 * 1024) return setError('Receipt image must be under 5MB.');
    setError('');
    setReceiptFile(file);
    setFilePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!fullName || !phoneNumber || !receiptFile) return setError('Add your name, phone number, and payment receipt.');
    setLoading(true);
    setError('');
    try {
      const extension = receiptFile.name.split('.').pop();
      const storageRef = ref(storage, `receipts/${user.uid}/${Date.now()}.${extension}`);
      const uploadTask = uploadBytesResumable(storageRef, receiptFile);
      uploadTask.on('state_changed', (snapshot) => setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)), (uploadError) => {
        console.error(uploadError);
        setError('Failed to upload receipt. Please try again.');
        setLoading(false);
      }, async () => {
        try {
          const receiptUrl = await getDownloadURL(uploadTask.snapshot.ref);
          await addDoc(collection(db, 'entries'), { userId: user.uid, email: user.email, fullName, phone: phoneNumber, tier: selectedTier, receiptUrl, status: 'pending', createdAt: serverTimestamp() });
          setIsSuccess(true);
        } catch (submitError) {
          console.error(submitError);
          setError('Could not save your registration. Please try again.');
        } finally {
          setLoading(false);
        }
      });
    } catch (submitError) {
      console.error(submitError);
      setError('Could not submit your receipt. Please try again.');
      setLoading(false);
    }
  };

  if (isSuccess) return <SuccessMessage amount={selectedTier} onReset={() => { setIsSuccess(false); setStep('categories'); }} />;

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">Welcome, {fullName || user.email}</p><h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Choose your category</h1><p className="mt-2 text-slate-500">Every category has three winners. Pick an entry amount to continue.</p></div>
        {step === 'categories' && <Link to="/wheel" className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-cyan-500 hover:text-cyan-700">View live draw</Link>}
        {step !== 'categories' && <button onClick={() => setStep('categories')} className="text-sm font-bold text-slate-600 underline underline-offset-4">Change category</button>}
      </div>
      {error && <p className="mb-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {step === 'categories' ? <CategoryGrid onChoose={chooseTier} prizeAmounts={prizeAmounts} /> : <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]"><RegisteredList amount={selectedTier} participants={participants} loading={loading} />{step === 'registered' ? <PaymentPanel amount={selectedTier} onDone={() => setStep('upload')} /> : <ReceiptForm fullName={fullName} setFullName={setFullName} phoneNumber={phoneNumber} setPhoneNumber={setPhoneNumber} handleFileChange={handleFileChange} filePreview={filePreview} handleSubmit={handleSubmit} loading={loading} uploadProgress={uploadProgress} />}</div>}
    </section>
  );
}

function CategoryGrid({ onChoose, prizeAmounts }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{TIERS.map((tier) => <button key={tier.amount} onClick={() => onChoose(tier.amount)} className="group overflow-hidden rounded-[1.75rem] bg-white text-left shadow-lg shadow-slate-900/5 transition hover:-translate-y-1 hover:shadow-xl"><div className={`flex h-40 items-center justify-center bg-gradient-to-br ${tier.color} text-7xl text-white`}><span className="transition group-hover:scale-110">{tier.icon}</span></div><div className="p-5"><p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{tier.label}</p><p className="mt-1 text-3xl font-black text-slate-950">{tier.amount} <span className="text-base font-bold text-slate-500">Birr</span></p><div className="mt-5 grid grid-cols-3 gap-1 border-t border-slate-100 pt-4 text-center"><PrizeValue label="1st" value={prizeAmounts[tier.amount]?.first} color="text-emerald-600" /><PrizeValue label="2nd" value={prizeAmounts[tier.amount]?.second} color="text-orange-600" /><PrizeValue label="3rd" value={prizeAmounts[tier.amount]?.third} color="text-cyan-700" /></div></div></button>)}</div>;
}

function PrizeValue({ label, value, color }) {
  return <div><span className={`block text-[10px] font-black uppercase ${color}`}>{label} win</span><span className="mt-1 block text-xs font-bold text-slate-700">{value || 0} Birr</span></div>;
}

function RegisteredList({ amount, participants, loading }) {
  return <div className="rounded-[1.75rem] bg-slate-950 p-6 text-white shadow-xl"><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">Category {amount}</p><h2 className="mt-1 text-2xl font-black">Registered list</h2></div><span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{participants.length} approved</span></div><div className="mt-6 space-y-2">{loading ? <p className="py-8 text-center text-sm text-slate-400">Loading the list...</p> : participants.length === 0 ? <p className="rounded-2xl border border-white/10 p-5 text-sm text-slate-400">No approved registrations yet. Your entry can be among the first.</p> : participants.map((participant, index) => <div key={participant.id} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3"><span className="font-semibold">{index + 1}. {participant.fullName}</span><span className="text-xs text-emerald-300">Registered</span></div>)}</div></div>;
}

function PaymentPanel({ amount, onDone }) {
  return <div className="rounded-[1.75rem] bg-white p-6 shadow-xl shadow-slate-900/5"><p className="text-xs font-black uppercase tracking-[0.2em] text-orange-600">Step 2</p><h2 className="mt-2 text-2xl font-black text-slate-950">Complete payment</h2><p className="mt-2 text-sm leading-6 text-slate-500">Transfer <strong className="text-slate-950">{amount} Birr</strong>, then come back here and upload the confirmation photo.</p><div className="my-6 space-y-3 rounded-2xl bg-orange-50 p-4 text-sm text-orange-950"><p><strong>Telebirr</strong><br /><span className="font-mono font-bold">0911XXXXXX</span></p><p><strong>CBE</strong><br /><span className="font-mono font-bold">1000XXXXXXXXX</span></p></div><button onClick={onDone} className="w-full rounded-2xl bg-orange-500 py-3.5 text-sm font-bold text-white transition hover:bg-orange-600">I have completed payment</button></div>;
}

function ReceiptForm({ fullName, setFullName, phoneNumber, setPhoneNumber, handleFileChange, filePreview, handleSubmit, loading, uploadProgress }) {
  return <form onSubmit={handleSubmit} className="rounded-[1.75rem] bg-white p-6 shadow-xl shadow-slate-900/5"><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">Step 3</p><h2 className="mt-2 text-2xl font-black text-slate-950">Upload payment photo</h2><div className="mt-6 space-y-4"><label className="block text-sm font-bold text-slate-700">Mobile phone number<input required type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="0912345678" className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-cyan-500" /></label><label className="block text-sm font-bold text-slate-700">Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-cyan-500" /></label><label className="block text-sm font-bold text-slate-700">Payment receipt photo<input required type="file" accept="image/*" onChange={handleFileChange} className="mt-2 block w-full text-sm text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-50 file:px-4 file:py-2.5 file:font-bold file:text-cyan-700" /></label>{filePreview && <img src={filePreview} alt="Payment receipt preview" className="h-40 w-full rounded-2xl border border-slate-100 object-contain" />}{loading && <p className="text-sm font-bold text-cyan-700">Uploading receipt: {uploadProgress}%</p>}<button disabled={loading} className="w-full rounded-2xl bg-slate-950 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">{loading ? 'Submitting...' : 'Submit registration'}</button></div></form>;
}

function SuccessMessage({ amount, onReset }) {
  return <div className="mx-auto max-w-md rounded-[1.75rem] bg-white p-8 text-center shadow-xl"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl font-black text-emerald-600">✓</div><h2 className="mt-5 text-2xl font-black text-slate-950">Receipt received</h2><p className="mt-2 text-sm leading-6 text-slate-500">Your {amount} Birr registration is now pending verification. We will review your payment proof.</p><button onClick={onReset} className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">Choose another category</button></div>;
}
