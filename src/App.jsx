import React, { useEffect, useState, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import { getIdTokenResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, isFirebaseConfigured } from './firebaseConfig';

// Import your page components
import LotteryRegistration from './components/LotteryRegistration';
import LotteryWheel from './components/LotteryWheel';
import AdminDashboard from './components/AdminDashboard';
import AuthPage from './components/AuthPage';

export default function App() {
  const [user, setUser] = useState(undefined);
  const [timeoutExceeded, setTimeoutExceeded] = useState(false);

  useEffect(() => {
    if (!isFirebaseConfigured) return;

    // Set a timeout to show loading message after 5 seconds
    const timeout = setTimeout(() => setTimeoutExceeded(true), 5000);

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u || null);
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

  if (!isFirebaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">ETHIO-DRAW</p>
          <h1 className="mt-3 text-2xl font-black text-slate-950">Firebase setup required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">Replace the placeholder values in <strong>.env.local</strong> with your Firebase web app configuration, then restart the Vite server.</p>
        </div>
      </div>
    );
  }

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-center">
        <div className="rounded-3xl bg-white p-8 shadow-xl max-w-sm">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-600" />
          <p className="font-bold text-slate-900">Loading Ethio-Draw...</p>
          <p className="mt-2 text-sm text-slate-500">Connecting to your account</p>
          {timeoutExceeded && (
            <p className="mt-4 text-xs text-orange-600 font-semibold">
              ⚠️ Taking longer than expected. Please check your internet connection.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Router>
      <div className="app-shell flex flex-col font-sans text-slate-900">
        <Navbar user={user} />

        {/* Main Content Area */}
        <main className="container mx-auto w-full flex-grow px-4 py-8 sm:px-6 sm:py-12">
          <Routes>
            <Route path="/" element={user ? <Navigate to="/draw" replace /> : <AuthPage />} />
            <Route path="/draw" element={user ? <LotteryRegistration user={user} /> : <Navigate to="/" replace />} />
            <Route path="/wheel" element={user ? <LotteryWheel /> : <Navigate to="/" replace />} />
            <Route path="/admin" element={user ? <AdminGuard /> : <Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200/70 py-6 text-center text-xs font-medium text-slate-400">
          © {new Date().getFullYear()} ETHIO-DRAW · Fila Draw
        </footer>
      </div>
    </Router>
  );
}

// Header Navigation Component
function Navbar({ user }) {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/');
  };

  return (
    <header className="app-nav sticky top-0 z-40 text-white shadow-lg shadow-slate-950/10">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand Logo / Title */}
        <Link to="/" className="brand-mark flex items-center gap-3 text-sm font-bold text-amber-300 sm:text-base">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-base text-slate-950 shadow-lg shadow-orange-500/20">✦</span>
          <span><strong>ETHIO-DRAW</strong><small className="ml-2 font-medium text-slate-400">Fila Draw</small></span>
        </Link>

        {/* Nav Links */}
        {user && <button onClick={handleSignOut} className="pill-button bg-white/10 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/20 sm:text-sm">Log out</button>}
      </div>
    </header>
  );
}

// Simple Admin Access Gatekeeper
function AdminGuard() {
  const [isAdmin, setIsAdmin] = useState(null);

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
    return <div className="mx-auto my-16 max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">Checking admin access...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto my-16 max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-xl font-bold text-red-600">!</div>
        <h2 className="mb-1 text-xl font-bold text-slate-800">Admin access required</h2>
        <p className="text-xs text-slate-500">Your account is signed in, but it has not been granted the admin role.</p>
      </div>
    );
  }

  return <AdminDashboard />;
}