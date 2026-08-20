import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';

// Import your page components
import LotteryRegistration from './components/LotteryRegistration';
import LotteryWheel from './components/LotteryWheel';
import AdminDashboard from './components/AdminDashboard';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-100 font-sans text-slate-900 flex flex-col">
        {/* Navigation Bar */}
        <Navbar />

        {/* Main Content Area */}
        <main className="flex-grow container mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<LotteryRegistration />} />
            <Route path="/wheel" element={<LotteryWheel />} />
            <Route path="/admin" element={<AdminGuard />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Official Draw Platform. All rights reserved.
        </footer>
      </div>
    </Router>
  );
}

// Header Navigation Component
function Navbar() {
  return (
    <header className="bg-slate-900 text-white shadow-md sticky top-0 z-40">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand Logo / Title */}
        <Link to="/" className="flex items-center gap-2 font-black text-lg tracking-wider text-amber-400">
          <span>🎰</span> ETHIO-DRAW
        </Link>

        {/* Nav Links */}
        <nav className="flex gap-1 md:gap-3">
          <Link
            to="/"
            className="px-3 py-2 rounded-xl text-xs md:text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            Enter Draw
          </Link>

          <Link
            to="/wheel"
            className="px-3 py-2 rounded-xl text-xs md:text-sm font-bold text-amber-400 hover:bg-amber-400/10 transition"
          >
            Live Wheel
          </Link>

          <Link
            to="/admin"
            className="px-3 py-2 rounded-xl text-xs md:text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            Admin
          </Link>
        </nav>
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