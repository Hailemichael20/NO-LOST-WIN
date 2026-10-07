import React, { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import { getIdTokenResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';

// Import your page components
const LotteryRegistration = lazy(() => import('./components/LotteryRegistration'));
const LotteryWheel = lazy(() => import('./components/LotteryWheel'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AuthPage = lazy(() => import('./components/AuthPage'));
const ChangePassword = lazy(() => import('./components/ChangePassword'));
import Announcements from './components/Announcements';
import { translations } from './translations';

export default function App() {
  const [user, setUser] = useState(undefined);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [profileRetry, setProfileRetry] = useState(0);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [timeoutExceeded, setTimeoutExceeded] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [language, setLanguage] = useState(() => localStorage.getItem('ethio-draw-language') || 'en');
  const t = translations[language] || translations.en;

  const changeLanguage = (nextLanguage) => {
    setLanguage(nextLanguage);
    localStorage.setItem('ethio-draw-language', nextLanguage);
  };

  useEffect(() => {
    document.title = `ETHIO-DRAW | ${t.lottery}`;
  }, [t.lottery]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setShowInstallBanner(true);
    };
    const handleAppInstalled = () => {
      setShowInstallBanner(false);
      setInstallPrompt(null);
    };

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      setShowInstallBanner(true);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) {
      setShowInstallBanner(false);
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setShowInstallBanner(false);
  };

  useEffect(() => {
    if (!isFirebaseConfigured) return;

    // Set a timeout to show loading message after 5 seconds
    const timeout = setTimeout(() => setTimeoutExceeded(true), 5000);

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
      setProfileLoading(Boolean(u));
      setProfileError('');
      if (!u) setMustChangePassword(false);
      clearTimeout(timeout);
    }, (error) => {
      console.error('Auth error:', error);
      setUser(null);
      clearTimeout(timeout);
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    setProfileLoading(true);
    setProfileError('');

    getDoc(doc(db, 'users', user.uid))
      .then((snapshot) => {
        if (active) setMustChangePassword(snapshot.data()?.mustChangePassword === true);
      })
      .catch((error) => {
        console.error('User security profile error:', error);
        if (active) setProfileError(t.profileLoadError);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => { active = false; };
  }, [user, profileRetry, t.profileLoadError]);

  if (!isFirebaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">ETHIO-DRAW</p>
          <h1 className="mt-3 text-2xl font-black text-slate-950">{t.firebaseSetup}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">{t.firebaseSetupCopy}</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="app-shell flex flex-col font-sans text-slate-900">
        <Navbar user={user} language={language} setLanguage={changeLanguage} />

        <main className="container mx-auto w-full flex-grow px-4 py-8 sm:px-6 sm:py-12">
          {user === undefined || (user && profileLoading) ? (
            <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">
              <div className="max-w-sm rounded-3xl bg-white p-8 shadow-xl">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-600" />
                <p className="font-bold text-slate-900">{t.loadingApp}</p>
                <p className="mt-2 text-sm text-slate-500">{t.connecting}</p>
                {timeoutExceeded && (
                  <p className="mt-4 text-xs text-orange-600 font-semibold">
                    ⚠️ {t.slowConnection}
                  </p>
                )}
              </div>
            </div>
          ) : profileError ? (
            <div role="alert" className="mx-auto my-12 max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center shadow-lg">
              <p className="font-semibold text-red-700">{profileError}</p>
              <button
                onClick={() => setProfileRetry((current) => current + 1)}
                className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"
              >
                {t.retry}
              </button>
            </div>
          ) : (
            <Suspense fallback={<div className="py-16 text-center text-sm font-semibold text-slate-500">{t.loadingApp}</div>}>
              <Routes>
                <Route path="/" element={user ? <Navigate to={mustChangePassword ? '/change-password' : '/draw'} replace /> : <AuthPage language={language} setLanguage={changeLanguage} />} />
                <Route path="/draw" element={user ? (mustChangePassword ? <Navigate to="/change-password" replace /> : <LotteryRegistration user={user} language={language} />) : <Navigate to="/" replace />} />
                <Route path="/wheel" element={user ? (mustChangePassword ? <Navigate to="/change-password" replace /> : <LotteryWheel language={language} />) : <Navigate to="/" replace />} />
                <Route path="/admin" element={user ? (mustChangePassword ? <Navigate to="/change-password" replace /> : <AdminGuard language={language} />) : <Navigate to="/" replace />} />
                <Route path="/change-password" element={user ? <ChangePassword user={user} mustChangePassword={mustChangePassword} onPasswordChanged={() => setMustChangePassword(false)} language={language} /> : <Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          )}
        </main>

        {showInstallBanner && (
          <div className="border-t border-slate-200 bg-slate-900 px-4 py-3 text-white">
            <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
              <p className="text-sm font-semibold">
                {installPrompt ? t.installAppPrompt : t.installIosPrompt}
              </p>
              {installPrompt && (
                <button onClick={handleInstallApp} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-900">
                  {t.installAppButton}
                </button>
              )}
            </div>
          </div>
        )}

        <footer className="border-t border-slate-200/70 px-4 py-6 text-center text-xs font-medium text-slate-400">
          {user && <Announcements language={language} />}
          <p className="mt-4">© {new Date().getFullYear()} {t.footerBrand}</p>
        </footer>
      </div>
    </Router>
  );
}

// Header Navigation Component
function Navbar({ user, language, setLanguage }) {
  const navigate = useNavigate();
  const t = translations[language] || translations.en;
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setIsAdmin(false);
      return () => { active = false; };
    }

    getIdTokenResult(user)
      .then(({ claims }) => {
        if (active) setIsAdmin(claims.admin === true);
      })
      .catch((error) => {
        console.error('Admin navigation claim error:', error);
        if (active) setIsAdmin(false);
      });
    return () => { active = false; };
  }, [user]);

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/');
  };

  return (
    <header className="app-nav sticky top-0 z-40 text-white shadow-lg shadow-slate-950/10">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-3 sm:px-4">
        {/* Brand Logo / Title */}
        <Link to="/" className="brand-mark flex min-w-0 items-center gap-2 text-sm font-bold text-amber-300 sm:gap-3 sm:text-base">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-sm text-slate-950 shadow-lg shadow-orange-500/20 sm:h-9 sm:w-9 sm:text-base">✦</span>
          <span className="min-w-0 truncate">
            <strong>ETHIO-DRAW</strong>
            <small className="ml-1.5 hidden font-medium text-slate-400 sm:inline">{t.lottery}</small>
          </span>
        </Link>

        {/* Nav Links */}
        <div className="flex items-center gap-2 sm:gap-3">
          {user && isAdmin && (
            <Link
              to="/admin"
              aria-label={t.adminLink}
              title={t.adminLink}
              className="rounded-lg px-2 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 sm:px-3"
            >
              <span className="sm:hidden" aria-hidden="true">⚙</span>
              <span className="hidden sm:inline">{t.adminLink}</span>
            </Link>
          )}
          {user && (
            <Link
              to="/change-password"
              aria-label={t.changePasswordTitle}
              title={t.changePasswordTitle}
              className="rounded-lg px-2 py-2 text-xs font-bold text-slate-200 hover:bg-white/10 sm:px-3"
            >
              <span className="sm:hidden" aria-hidden="true">🔒</span>
              <span className="hidden sm:inline">{t.changePasswordNav}</span>
            </Link>
          )}
          <label className="sr-only" htmlFor="app-language">{t.language}</label>
          <select id="app-language" value={language} onChange={(event) => setLanguage(event.target.value)} className="max-w-[110px] rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-[11px] font-bold text-white outline-none ring-0 transition focus:border-cyan-400 sm:text-xs">
            <option value="en">{t.languageOptionEn}</option>
            <option value="am">{t.languageOptionAm}</option>
          </select>
          {user && <button onClick={handleSignOut} className="pill-button bg-white/10 px-3 py-2 text-[11px] font-bold text-slate-200 hover:bg-white/20 sm:px-4 sm:text-sm">{t.logout}</button>}
        </div>
      </div>
    </header>
  );
}

// Simple Admin Access Gatekeeper
function AdminGuard({ language }) {
  const [isAdmin, setIsAdmin] = useState(null);
  const t = translations[language] || translations.en;

  useEffect(() => {
    let active = true;
    getIdTokenResult(auth.currentUser, true)
      .then(({ claims }) => {
        if (active) setIsAdmin(claims.admin === true);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => { active = false; };
  }, []);

  if (isAdmin === null) {
    return <div className="mx-auto my-16 max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">{t.checkingAdmin}</div>;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto my-16 max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-xl font-bold text-red-600">!</div>
        <h2 className="mb-1 text-xl font-bold text-slate-800">{t.adminRequired}</h2>
        <p className="text-xs text-slate-500">{t.adminRequiredCopy}</p>
      </div>
    );
  }

  return <AdminDashboard language={language} />;
}