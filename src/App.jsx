import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, isFirebaseConfigured } from './firebaseConfig';

// Import your page components
import LotteryRegistration from './components/LotteryRegistration';
import LotteryWheel from './components/LotteryWheel';
import AdminDashboard from './components/AdminDashboard';
import AuthPage from './components/AuthPage';

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

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
        <div className="rounded-3xl bg-white p-8 shadow-xl">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-600" />
          <p className="font-bold text-slate-900">Loading Ethio-Draw...</p>
          <p className="mt-2 text-sm text-slate-500">Connecting to your account</p>
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
            <Route path="/admin" element={<AdminGuard />} />
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Replace with your preferred secret admin code
  const ADMIN_SECRET = 'admin123';

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === ADMIN_SECRET) {
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Incorrect passcode');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-sm mx-auto my-16 p-6 bg-white rounded-2xl shadow-xl border border-slate-200 text-center">
        <div className="w-12 h-12 bg-slate-100 text-slate-700 rounded-full flex items-center justify-center mx-auto mb-3 font-bold text-xl">
          🔒
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-1">Admin Passcode</h2>
        <p className="text-xs text-slate-500 mb-4">Enter passcode to access the verification dashboard</p>

        {error && <p className="text-xs text-red-500 font-bold mb-3">{error}</p>}

        <form onSubmit={handleLogin} className="space-y-3">
          <input
            type="password"
            placeholder="Enter passcode"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
          />
          <button
            type="submit"
            className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition"
          >
            Unlock Dashboard
          </button>
        </form>
      </div>
    );
  }

  return <AdminDashboard />;
}