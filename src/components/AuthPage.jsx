import React, { useEffect, useState } from 'react';
import { auth, db } from '../firebaseConfig';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { translations } from '../translations';

const MODES = {
  login: { titleKey: 'loginTitle', actionKey: 'loginAction' },
  register: { titleKey: 'registerTitle', actionKey: 'registerAction' },
};

async function notifyAdminOfPasswordRequest(identifier) {
  const response = await fetch('/api/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  if (!response.ok) throw new Error('password-request-notification-failed');
}

export default function AuthPage({ language, setLanguage }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryChoice, setRecoveryChoice] = useState('email');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [adminContact, setAdminContact] = useState({ phone: '+251930851916', telegram: '@ethiodraw' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const t = translations[language] || translations.en;

  useEffect(() => {
    let active = true;

    if (!db) return undefined;
    getDoc(doc(db, 'settings', 'contact'))
      .then((snapshot) => {
        if (active && snapshot.exists()) {
          const data = snapshot.data();
          setAdminContact({
            phone: data.phone || adminContact.phone,
            telegram: data.telegram || adminContact.telegram,
          });
        }
      })
      .catch((contactError) => console.error('Contact settings error:', contactError));

    return () => { active = false; };
  }, []);

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
      if (mode === 'register') {
        const authEmail = phoneLoginEmail(phone);
        const credential = await createUserWithEmailAndPassword(auth, authEmail, password);
        await updateProfile(credential.user, { displayName: name });
        await setDoc(doc(db, 'users', credential.user.uid), {
          fullName: name,
          phone: normalizePhone(phone),
          createdAt: serverTimestamp(),
        });
      } else {
        const loginIdentifier = phone.trim();
        const authEmail = loginIdentifier.includes('@')
          ? loginIdentifier
          : phoneLoginEmail(loginIdentifier);
        await signInWithEmailAndPassword(auth, authEmail, password);
      }
    } catch (authError) {
      setError(authError.code === 'auth/email-already-in-use'
        ? t.errorAlreadyUser
        : ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(authError.code)
          ? t.errorWrongCredentials
          : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    if (!recoveryEmail) {
      setError(t.errorResetEmpty);
      return;
    }

    setBusy(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, recoveryEmail);
      try {
        await notifyAdminOfPasswordRequest(recoveryEmail.trim());
      } catch (notificationError) {
        console.error('Password reset notification error:', notificationError);
        setError(t.resetNotificationFailed);
        setShowRecoveryModal(false);
        return;
      }
      setMessage(t.successReset);
      setShowRecoveryModal(false);
    } catch (authError) {
      setError(t.errorResetFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleAdminResetRequest = async (event) => {
    event.preventDefault();
    if (!resetIdentifier.trim()) {
      setError(t.errorIdentifierEmpty);
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      await notifyAdminOfPasswordRequest(resetIdentifier.trim());
      setMessage(t.neutralResetMessage);
      setResetIdentifier('');
      setShowRecoveryModal(false);
    } catch (resetError) {
      console.error('Password reset request error:', resetError);
      setError(t.errorRequestFailed);
    } finally {
      setBusy(false);
    }
  };

  const content = MODES[mode];
  return (
    <AuthShell language={language} setLanguage={setLanguage}>
      <AuthHeader eyebrow={t.yourChance} title={t[content.titleKey]} copy={t.footerText} />
      <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-sm font-bold">
        {Object.entries(MODES).map(([key, item]) => (
          <button key={key} onClick={() => switchMode(key)} className={`pill-button py-2.5 transition ${mode === key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>
            {t[item.actionKey]}
          </button>
        ))}
      </div>
      <Feedback error={error} message={message} />
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && <Field label={t.fullName} value={name} onChange={setName} placeholder={t.placeholderName} required />}
        <Field
          label={mode === 'login' ? t.loginIdentifier : t.mobile}
          type={mode === 'login' ? 'text' : 'tel'}
          value={phone}
          onChange={setPhone}
          placeholder={mode === 'login' ? t.loginIdentifierPlaceholder : t.placeholderPhone}
          autoComplete={mode === 'login' ? 'username' : 'tel'}
        />
        <Field label={t.password} type="password" value={password} onChange={setPassword} placeholder={t.placeholderPassword} minLength={6} />
        <button disabled={busy} className="pill-button w-full bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 text-sm font-bold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? t.wait : mode === 'login' ? t.authButtonLogin : t.authButtonRegister}
        </button>
      </form>

      {mode === 'login' && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => { setError(''); setRecoveryChoice('email'); setShowRecoveryModal(true); }} className="pill-button w-full py-3 text-sm font-bold text-cyan-700 hover:bg-cyan-50">
            {t.forgotPassword}
          </button>
          <button type="button" onClick={() => { setError(''); setRecoveryChoice('admin'); setShowRecoveryModal(true); }} className="pill-button w-full py-3 text-sm font-bold text-slate-700 hover:bg-slate-100">
            {t.changePasswordLink}
          </button>
        </div>
      )}

      {showRecoveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-black text-slate-900">{t.accountRecovery}</h3>
              <button type="button" onClick={() => setShowRecoveryModal(false)} className="text-sm font-bold text-slate-500">✕</button>
            </div>

            <div className="mb-5 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setRecoveryChoice('email')} className={`rounded-xl px-3 py-2 text-sm font-bold ${recoveryChoice === 'email' ? 'bg-cyan-600 !text-white' : 'bg-slate-100 !text-slate-700'}`}>
                {t.recoverEmail}
              </button>
              <button type="button" onClick={() => setRecoveryChoice('admin')} className={`rounded-xl px-3 py-2 text-sm font-bold ${recoveryChoice === 'admin' ? 'bg-cyan-600 !text-white' : 'bg-slate-100 !text-slate-700'}`}>
                {t.contactAdmin}
              </button>
            </div>

            {recoveryChoice === 'email' ? (
              <form onSubmit={handleReset} className="space-y-4">
                <Field label={t.recoveryEmail} type="email" value={recoveryEmail} onChange={setRecoveryEmail} placeholder={t.placeholderEmail} />
                <button disabled={busy} className="pill-button w-full bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 text-sm font-bold !text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? t.wait : t.recoveryButton}
                </button>
              </form>
            ) : (
              <form onSubmit={handleAdminResetRequest} className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-bold text-slate-900">{t.adminContact}</p>
                  <p className="mt-1">{adminContact.phone}</p>
                  <p className="mt-1">{t.telegramLabel}: {adminContact.telegram}</p>
                </div>
                <Field label={t.loginIdentifier} type="text" value={resetIdentifier} onChange={setResetIdentifier} placeholder={t.resetIdentifierHint} />
                <button disabled={busy} className="pill-button w-full bg-gradient-to-r from-amber-500 to-orange-600 py-3.5 text-sm font-bold !text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? t.wait : t.requestReset}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </AuthShell>
  );
}

function AuthShell({ children, language, setLanguage }) {
  const t = translations[language] || translations.en;
  const handleLanguageChange = (event) => setLanguage(event.target.value);

  return <section className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-soft"><div className="auth-visual flex min-h-[22rem] flex-col items-center justify-center px-6 py-12 text-center text-white sm:min-h-[27rem] sm:px-12"><p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">ETHIO-DRAW</p><h1 className="auth-title mt-5 text-6xl font-bold leading-none sm:text-8xl">ETHIO-DRAW</h1><p className="mt-4 text-xl font-semibold text-amber-300 sm:text-2xl">{t.lottery}</p><p className="mt-5 max-w-md text-base text-slate-300 sm:text-lg">{t.heroText}</p><div className="mt-3 flex max-w-md flex-wrap items-center justify-center gap-2 text-xs font-medium text-slate-200 sm:text-sm"><a href="https://t.me/+6vcHcJ6FeuswZmY0" target="_blank" rel="noreferrer" className="font-semibold text-cyan-200 underline decoration-cyan-300/80 underline-offset-4 hover:text-white">Telegram</a><span className="opacity-70">•</span><a href="tel:+251930851916" className="font-semibold text-amber-200 underline decoration-amber-300/80 underline-offset-4 hover:text-white">+251930851916</a><span className="opacity-70">•</span><span>{t.welcomeContact}</span></div><div className="mt-8 h-1 w-20 rounded-full bg-gradient-to-r from-cyan-300 to-amber-300" /></div><div className="w-full p-6 sm:p-12"><div className="mb-6 flex items-center justify-end gap-3"><label htmlFor="auth-language-preference" className="text-xs font-bold text-slate-500">{t.language}</label><select id="auth-language-preference" value={language} onChange={handleLanguageChange} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-cyan-400"><option value="en">{t.languageOptionEn}</option><option value="am">{t.languageOptionAm}</option></select></div>{children}</div></section>;
}

function AuthHeader({ eyebrow, title, copy }) {
  return <div className="mb-7"><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">{eyebrow}</p><h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{copy}</p></div>;
}

function Field({ label, type = 'text', value, onChange, placeholder, required = true, minLength, autoComplete }) {
  return <label className="block text-sm font-bold text-slate-700"><span className="mb-2 block">{label}</span><input required={required} minLength={minLength} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={autoComplete} className="w-full rounded-2xl border-0 bg-slate-100 px-4 py-3.5 font-normal outline-none ring-2 ring-transparent transition placeholder:text-slate-400 focus:bg-white focus:ring-cyan-400" /></label>;
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
