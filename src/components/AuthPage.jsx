import React, { useState } from 'react';
import { auth, db } from '../firebaseConfig';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

const translations = {
  en: {
    language: 'Language',
    languageLabel: 'English',
    heroText: 'Welcome! Make a wish and play.',
    loginTitle: 'Welcome back',
    registerTitle: 'Create your account',
    loginAction: 'Log in',
    registerAction: 'Register',
    footerText: 'Your next draw starts here. Sign in to choose a category and play.',
    recoveryTitle: 'Reset your password',
    recoveryCopy: 'We will email you a secure link to choose a new password.',
    recoveryButton: 'Send reset link',
    backToLogin: 'Back to login',
    fullName: 'Full name',
    mobile: 'Mobile phone number',
    password: 'Password',
    recoveryEmail: 'Recovery email',
    placeholderName: 'Your full name',
    placeholderPhone: '0911234567',
    placeholderPassword: 'At least 6 characters',
    placeholderEmail: 'you@example.com',
    enterDraw: 'Enter Fila Draw',
    createAccount: 'Create my account',
    recoverEmail: 'Recover with email',
    wait: 'Please wait...',
    accountRecovery: 'Account recovery',
    recoveryType: 'We will email you a secure link to choose a new password.',
    registerTab: 'Register',
    loginTab: 'Log in',
    yourChance: 'Your chance, your account',
    errorAlreadyUser: 'This mobile number is already registered. Log in instead.',
    errorWrongCredentials: 'Mobile number or password is incorrect.',
    errorResetEmpty: 'Enter your email address first.',
    errorResetFailed: 'We could not send the reset email. Check the address and try again.',
    successReset: 'Password reset instructions have been sent to your email.',
    authButtonRegister: 'Create my account',
    authButtonLogin: 'Enter Fila Draw',
  },
  am: {
    language: 'ቋንቋ',
    languageLabel: 'አማርኛ',
    heroText: 'እንኳን ደህና መጡ! ምኞትዎን ያድርጉ እና ይጫወቱ።',
    loginTitle: 'ደግመው ገብተዋል',
    registerTitle: 'መለያዎን ይፍጠሩ',
    loginAction: 'ግባ',
    registerAction: 'መዝግብ',
    footerText: 'ቀጣዩ ውርጃዎ እዚህ ይጀምራል። ምድብ ለመመርጥ ይግቡ።',
    recoveryTitle: 'የይለፍ ቃል ዳግም አስጀምር',
    recoveryCopy: 'አዲስ የይለፍ ቃል ለመምረጥ ደህንነቱ የተጠበቀ አገናኝ እንልክሎታለን።',
    recoveryButton: 'አገናኝ ላክ',
    backToLogin: 'ወደ መግቢያ ተመለስ',
    fullName: 'ሙሉ ስም',
    mobile: 'ስልክ ቁጥር',
    password: 'የይለፍ ቃል',
    recoveryEmail: 'የመልእክት ሳጥን ኢሜይል',
    placeholderName: 'ሙሉ ስምዎ',
    placeholderPhone: '0911234567',
    placeholderPassword: 'ቢያንስ 6 ቁምፊዎች',
    placeholderEmail: 'you@example.com',
    enterDraw: 'ወደ ፊላ ውርጃ ግባ',
    createAccount: 'መለያ ፍጠር',
    recoverEmail: 'በኢሜይል ያገኙ',
    wait: 'እባክዎ ይጠብቁ...',
    accountRecovery: 'መለያ እንደገና ማግኛ',
    recoveryType: 'አዲስ የይለፍ ቃል ለመምረጥ ደህንነቱ የተጠበቀ አገናኝ እንልክሎታለን።',
    registerTab: 'መዝግብ',
    loginTab: 'ግባ',
    yourChance: 'የእርስዎ እድ chance',
    errorAlreadyUser: 'ይህ ስልክ ቁጥር ቀድሞ ተመዝግቧል። እባክዎ ግባ።',
    errorWrongCredentials: 'ስልክ ቁጥር ወይም የይለፍ ቃል ትክክል አይደለም።',
    errorResetEmpty: 'መጀመሪያ ኢሜይል ያስገቡ።',
    errorResetFailed: 'የይለፍ ቃል አስጀምር አልተላከምም። ኢሜይሉን ያረጋግጡ።',
    successReset: 'የይለፍ ቃል ማስጀመር መመሪያ ወደ ኢሜይልዎ ተልኳል።',
    authButtonRegister: 'መለያ ፍጠር',
    authButtonLogin: 'ወደ ፊላ ውርጃ ግባ',
  },
};

const MODES = {
  login: { titleKey: 'loginTitle', actionKey: 'loginAction', switchText: 'Create an account', switchMode: 'register' },
  register: { titleKey: 'registerTitle', actionKey: 'registerAction', switchText: 'Already have an account?', switchMode: 'login' },
};

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [language, setLanguage] = useState(() => localStorage.getItem('ethio-draw-language') || 'en');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const t = translations[language] || translations.en;

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
        ? t.errorAlreadyUser
        : authError.code === 'auth/invalid-credential'
          ? t.errorWrongCredentials
          : authError.message.replace('Firebase: ', '').replace(/ \(auth\/[^)]+\)\.?$/, ''));
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
      setMessage(t.successReset);
    } catch (authError) {
      setError(t.errorResetFailed);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'reset') {
    return (
      <AuthShell language={language} setLanguage={setLanguage}>
        <AuthHeader eyebrow={t.accountRecovery} title={t.recoveryTitle} copy={t.recoveryCopy} />
        <Feedback error={error} message={message} />
        <form onSubmit={handleReset} className="space-y-4">
          <Field label={t.recoveryEmail} type="email" value={recoveryEmail} onChange={setRecoveryEmail} placeholder={t.placeholderEmail} />
          <button disabled={busy} className="pill-button w-full bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 text-sm font-bold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? t.wait : t.recoveryButton}
          </button>
        </form>
        <button onClick={() => switchMode('login')} className="pill-button mt-5 w-full py-3 text-sm font-bold text-cyan-700 hover:bg-cyan-50">{t.backToLogin}</button>
      </AuthShell>
    );
  }

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
        <Field label={t.mobile} type="tel" value={phone} onChange={setPhone} placeholder={t.placeholderPhone} />
        <Field label={t.password} type="password" value={password} onChange={setPassword} placeholder={t.placeholderPassword} minLength={6} />
        <button disabled={busy} className="pill-button w-full bg-gradient-to-r from-cyan-500 to-blue-600 py-3.5 text-sm font-bold text-white shadow-glow disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? t.wait : mode === 'login' ? t.authButtonLogin : t.authButtonRegister}
        </button>
      </form>
      {mode === 'login' && <button onClick={() => switchMode('reset')} className="pill-button mt-5 w-full py-3 text-sm font-bold text-cyan-700 hover:bg-cyan-50">{t.recoverEmail}</button>}
    </AuthShell>
  );
}

function AuthShell({ children, language, setLanguage }) {
  const handleLanguageChange = (event) => {
    const nextLanguage = event.target.value;
    setLanguage(nextLanguage);
    localStorage.setItem('ethio-draw-language', nextLanguage);
  };

  return <section className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-soft"><div className="auth-visual flex min-h-[22rem] flex-col items-center justify-center px-6 py-12 text-center text-white sm:min-h-[27rem] sm:px-12"><p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">ETHIO-DRAW</p><h1 className="auth-title mt-5 text-6xl font-bold leading-none sm:text-8xl">ETHIO-DRAW</h1><p className="mt-4 text-xl font-semibold text-amber-300 sm:text-2xl">Fila Draw</p><p className="mt-5 max-w-md text-base text-slate-300 sm:text-lg">{translations[language]?.heroText || translations.en.heroText}</p><div className="mt-8 h-1 w-20 rounded-full bg-gradient-to-r from-cyan-300 to-amber-300" /></div><div className="w-full p-6 sm:p-12"><div className="mb-6 flex items-center justify-end gap-3"><label htmlFor="language-preference" className="text-xs font-bold text-slate-500">{translations[language]?.language || translations.en.language}</label><select id="language-preference" value={language} onChange={handleLanguageChange} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-cyan-400"><option value="en">English</option><option value="am">አማርኛ</option></select></div>{children}</div></section>;
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
