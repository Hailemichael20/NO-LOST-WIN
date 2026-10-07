import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmailAuthProvider, getIdTokenResult, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { apiBaseUrl } from '../cloudinaryUpload';
import { passwordChangeErrorKey, validateNewPassword } from '../../lib/password-change';
import { translations } from '../translations';
import AdminPasswordResets from './AdminPasswordResets';

export default function ChangePassword({ user, mustChangePassword, onPasswordChanged, language }) {
  const t = translations[language] || translations.en;
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckError, setAdminCheckError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentPasswordLabel = useMemo(
    () => (mustChangePassword ? t.temporaryPasswordLabel : t.currentPassword),
    [mustChangePassword, t],
  );

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

  const clearPasswordChangeFlag = async () => {
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(`${apiBaseUrl}/api/clear-password-change-flag`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not clear the password-change requirement.');

      onPasswordChanged();
      setPasswordUpdated(false);
      setNotice(t.passwordChanged);
    } catch (flagError) {
      console.error('Could not clear required password change flag:', flagError);
      setNotice(t.passwordChangedFlagFailed);
    } finally {
      setBusy(false);
    }
  };

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
      const credentialPassword = mustChangePassword ? currentPassword || 'temporary-password' : currentPassword;
      const credential = EmailAuthProvider.credential(user.email, credentialPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      if (mustChangePassword) {
        setPasswordUpdated(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmation('');
        try {
          await clearPasswordChangeFlag();
        } catch (flagError) {
          console.error('Could not clear required password change flag:', flagError);
        }
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setNotice(t.passwordChanged);
    } catch (changeError) {
      console.error('Password change error:', changeError);
      setError(t[passwordChangeErrorKey(changeError.code)] || t.passwordChangeFailed);
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
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">{t.accountSecurity}</p>
        {isAdmin
          ? <h2 className="mt-2 text-2xl font-black text-slate-950">{t.myPassword}</h2>
          : <h1 className="mt-2 text-2xl font-black text-slate-950">{t.myPassword}</h1>}
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {mustChangePassword ? t.requiredPasswordChangeCopy : t.changePasswordCopy}
        </p>

        {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</p>}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mustChangePassword && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {t.temporaryPasswordHint}
            </p>
          )}
          <PasswordField label={currentPasswordLabel} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField label={t.newPassword} value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField label={t.confirmNewPassword} value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
          <p className="text-xs text-slate-500">{t.passwordMinimumLength}</p>
          <button
            disabled={busy}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t.wait : t.changePassword}
          </button>
        </form>

        {notice === t.passwordChanged && (
          <button
            onClick={() => navigate('/draw', { replace: true })}
            className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            {t.continueToApp}
          </button>
        )}
        {passwordUpdated && mustChangePassword && (
          <button
            disabled={busy}
            onClick={clearPasswordChangeFlag}
            className="mt-3 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 disabled:opacity-50"
          >
            {busy ? t.wait : t.retryClearPasswordFlag}
          </button>
        )}
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
