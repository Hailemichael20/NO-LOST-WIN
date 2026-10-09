import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmailAuthProvider, getIdTokenResult, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { apiBaseUrl } from '../cloudinaryUpload';
import { passwordChangeErrorKey, validateNewPassword } from '../../lib/password-change';
import { translations } from '../translations';
import AdminPasswordResets from './AdminPasswordResets';

export default function ChangePassword({ user, mustChangePassword, onPasswordChanged, language }) {
  const navigate = useNavigate();
  const redirectTimer = useRef(null);
  const t = translations[language] || translations.en;
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckError, setAdminCheckError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => () => window.clearTimeout(redirectTimer.current), []);

  React.useEffect(() => {
    let active = true;
    getIdTokenResult(user, true)
      .then(({ claims }) => {
        if (active) setIsAdmin(claims.admin === true);
      })
      .catch((error) => {
        console.error('Admin password tools access check failed:', error);
        if (active) setAdminCheckError(t.adminToolsLoadError);
      });
    return () => { active = false; };
  }, [t.adminToolsLoadError, user]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    const validationError = validateNewPassword(newPassword, confirmation);
    if (validationError) {
      setError(validationError === 'tooWeak' ? t.passwordTooWeak : t.passwordsDoNotMatch);
      return;
    }
    if (!user.email) {
      setError(t.passwordChangeFailed);
      return;
    }

    setBusy(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      if (mustChangePassword) {
        try {
          const idToken = await user.getIdToken();
          const response = await fetch(`${apiBaseUrl}/api/clear-password-change-flag`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}` },
          });
          if (!response.ok) {
            throw new Error(`Password-change flag cleanup failed (${response.status}).`);
          }
        } catch (flagError) {
          console.error('Could not clear required password change flag:', flagError);
        }
      }

      onPasswordChanged();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setNotice(t.passwordChanged);
      redirectTimer.current = window.setTimeout(() => {
        navigate('/draw', { replace: true });
      }, 1200);
    } catch (changeError) {
      console.error('Password change error:', changeError);
      const errorKey = passwordChangeErrorKey(changeError.code);
      setError(['wrongCurrentPassword', 'passwordTooWeak'].includes(errorKey)
        ? t[errorKey]
        : t.passwordChangeFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      {isAdmin && <AdminPasswordResets user={user} language={language} />}
      {adminCheckError && (
        <p role="alert" className="mx-auto my-4 max-w-lg rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {adminCheckError}
        </p>
      )}
      <section className="mx-auto my-6 max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-8">
        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordField label={t.currentPassword} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField label={t.newPassword} value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField label={t.confirmNewPassword} value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
          <button
            disabled={busy}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t.wait : t.changePassword}
          </button>
        </form>
      </section>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete }) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <input
        required
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-cyan-500"
      />
    </label>
  );
}
