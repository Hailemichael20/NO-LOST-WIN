import React, { useState } from 'react';
import { auth, db } from '../firebaseConfig';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

const MODES = {
  login: { title: 'Welcome back', action: 'Log in', switchText: 'Create an account', switchMode: 'register' },
  register: { title: 'Create your account', action: 'Register', switchText: 'Already have an account?', switchMode: 'login' },
};

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const authEmail = phoneLoginEmail(phone);
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, authEmail, password);
        await updateProfile(credential.user, { displayName: name });
        await setDoc(doc(db, 'users', credential.user.uid), {
          fullName: name,
          phone: normalizePhone(phone),
          createdAt: serverTimestamp(),
        });
      } else {
        await signInWithEmailAndPassword(auth, authEmail, password);
      }
    } catch (authError) {
      setError(authError.code === 'auth/email-already-in-use'
        ? 'This mobile number is already registered. Log in instead.'
        : authError.code === 'auth/invalid-credential'
          ? 'Mobile number or password is incorrect.'
          : authError.message.replace('Firebase: ', '').replace(/ \(auth\/[^)]+\)\.?$/, ''));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    if (!recoveryEmail) {
      setError('Enter your email address first.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, recoveryEmail);
      setMessage('Password reset instructions have been sent to your email.');
    } catch (authError) {
      setError('We could not send the reset email. Check the address and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'reset') {
    return (
      <AuthShell>
        <AuthHeader eyebrow="Account recovery" title="Reset your password" copy="We will email you a secure link to choose a new password." />
        <Feedback error={error} message={message} />
        <form onSubmit={handleReset} className="space-y-4">
          <Field label="Recovery email" type="email" value={recoveryEmail} onChange={setRecoveryEmail} placeholder="you@example.com" />
          <button disabled={busy} className="pill-button w-full bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 text-sm font-bold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
        <button onClick={() => switchMode('login')} className="pill-button mt-5 w-full py-3 text-sm font-bold text-cyan-700 hover:bg-cyan-50">Back to login</button>
      </AuthShell>
    );
  }

  const content = MODES[mode];
  return (
    <AuthShell>
      <AuthHeader eyebrow="Your chance, your account" title={content.title} copy="Your next draw starts here. Sign in to choose a category and play." />
      <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-sm font-bold">
        {Object.entries(MODES).map(([key, item]) => (
          <button key={key} onClick={() => switchMode(key)} className={`pill-button py-2.5 transition ${mode === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>
            {item.action}
          </button>
        ))}
      </div>
      <Feedback error={error} message={message} />
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && <Field label="Full name" value={name} onChange={setName} placeholder="Your full name" required />}
        <Field label="Mobile phone number" type="tel" value={phone} onChange={setPhone} placeholder="0911234567" />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 6 characters" minLength={6} />
        <button disabled={busy} className="pill-button w-full bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 text-sm font-bold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Please wait...' : mode === 'login' ? 'Enter Fila Draw' : 'Create my account'}
        </button>
      </form>
      {mode === 'login' && <button onClick={() => switchMode('reset')} className="pill-button mt-5 w-full py-3 text-sm font-bold text-cyan-700 hover:bg-cyan-50">Recover with email</button>}
    </AuthShell>
  );
}

function AuthShell({ children }) {
  return <section className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-soft"><div className="auth-visual flex min-h-[22rem] flex-col items-center justify-center px-6 py-12 text-center text-white sm:min-h-[27rem] sm:px-12"><p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">ETHIO-DRAW</p><h1 className="auth-title mt-5 text-6xl font-bold leading-none sm:text-8xl">ETHIO-DRAW</h1><p className="mt-4 text-xl font-semibold text-amber-300 sm:text-2xl">Fila Draw</p><p className="mt-5 max-w-md text-base text-slate-300 sm:text-lg">Welcome! Make a wish and play.</p><div className="mt-8 h-1 w-20 rounded-full bg-gradient-to-r from-cyan-300 to-amber-300" /></div><div className="w-full p-6 sm:p-12">{children}</div></section>;
}

function AuthHeader({ eyebrow, title, copy }) {
  return <div className="mb-7"><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">{eyebrow}</p><h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{copy}</p></div>;
}

function Field({ label, type = 'text', value, onChange, placeholder, required = true, minLength }) {
  return <label className="block text-sm font-bold text-slate-700"><span className="mb-2 block">{label}</span><input required={required} minLength={minLength} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-2xl border-0 bg-slate-100 px-4 py-3.5 font-normal outline-none ring-2 ring-transparent transition placeholder:text-slate-400 focus:bg-white focus:ring-cyan-400" /></label>;
}

function Feedback({ error, message }) {
  if (!error && !message) return null;
  return <p className={`mb-4 rounded-2xl px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{error || message}</p>;
}

function normalizePhone(phone) {
  const trimmedPhone = phone.trim();
  if (trimmedPhone.startsWith('09')) return `+251${trimmedPhone.slice(1)}`;
  return trimmedPhone;
}

function phoneLoginEmail(phone) {
  return `${normalizePhone(phone).replace(/[^0-9]/g, '')}@phone.playwin.local`;
}
