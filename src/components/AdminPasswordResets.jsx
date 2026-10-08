import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { apiBaseUrl } from '../cloudinaryUpload';
import { translations } from '../translations';

const normalizePhone = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('0')) return `+251${trimmed.slice(1)}`;
  return trimmed;
};

export default function AdminPasswordResets({ user, language }) {
  const t = translations[language] || translations.en;
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [requestsError, setRequestsError] = useState('');
  const [usersError, setUsersError] = useState('');
  const [entriesError, setEntriesError] = useState('');
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyUserId, setBusyUserId] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetErrorUserId, setResetErrorUserId] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [copyMessage, setCopyMessage] = useState('');

  useEffect(() => {
    const requestsQuery = query(
      collection(db, 'passwordResetRequests'),
      where('status', '==', 'pending'),
    );
    return onSnapshot(requestsQuery, (snapshot) => {
      setRequests(snapshot.docs
        .map((requestDoc) => ({
          id: requestDoc.id,
          ...requestDoc.data(),
        }))
        .sort((first, second) => (
          (second.createdAt?.toMillis?.() || 0) - (first.createdAt?.toMillis?.() || 0)
        )));
      setRequestsError('');
      setRequestsLoading(false);
    }, (error) => {
      console.error('Password reset requests listener error:', error);
      setRequestsError(t.resetRequestsLoadError);
      setRequestsLoading(false);
    });
  }, [t.resetRequestsLoadError]);

  useEffect(() => {
    return onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map((userDoc) => ({
        id: userDoc.id,
        ...userDoc.data(),
      })));
      setUsersError('');
      setUsersLoading(false);
    }, (error) => {
      console.error('Registered users listener error:', error);
      setUsersError(t.registeredUsersLoadError);
      setUsersLoading(false);
    });
  }, [t.registeredUsersLoadError]);

  useEffect(() => {
    return onSnapshot(collection(db, 'entryPrivate'), (snapshot) => {
      setEntries(snapshot.docs.map((entryDoc) => entryDoc.data()));
      setEntriesError('');
      setEntriesLoading(false);
    }, (error) => {
      console.error('Registered numbers listener error:', error);
      setEntriesError(t.registeredNumbersLoadError);
      setEntriesLoading(false);
    });
  }, [t.registeredNumbersLoadError]);

  const numbersByUser = useMemo(() => {
    const result = new Map();
    entries.forEach((entry) => {
      if (!entry.userId || entry.number === undefined || entry.number === null) return;
      const numbers = result.get(entry.userId) || new Set();
      numbers.add(String(entry.number).replace(/^#/, ''));
      result.set(entry.userId, numbers);
    });
    return result;
  }, [entries]);

  const matchingUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];

    return users
      .filter((registeredUser) => {
        const numbers = [...(numbersByUser.get(registeredUser.id) || [])];
        const searchableValues = [
          registeredUser.fullName,
          registeredUser.phone,
          ...numbers,
          ...numbers.map((number) => `#${number.padStart(3, '0')}`),
        ];
        return searchableValues.some((value) => String(value || '').toLowerCase().includes(term));
      })
      .sort((first, second) => String(first.fullName || '').localeCompare(String(second.fullName || '')));
  }, [numbersByUser, search, users]);

  const resetPassword = async (actionId, identifier, uid = '') => {
    setBusyUserId(actionId);
    setResetError('');
    setResetErrorUserId('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/admin-reset-password`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid, identifier }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || t.passwordResetFailed);
      if (typeof result.temporaryPassword !== 'string' || !result.temporaryPassword) {
        throw new Error(t.passwordResetFailed);
      }
      setTemporaryPassword(result.temporaryPassword);
      setCopyMessage('');
    } catch (error) {
      console.error('Admin user password reset error:', error);
      setResetError(t.passwordResetFailed);
      setResetErrorUserId(actionId);
    } finally {
      setBusyUserId('');
    }
  };

  const resetRegisteredUserPassword = (registeredUser) => {
    const phone = String(registeredUser.phone || '');
    const matchingRequest = requests.find((request) => (
      request.status === 'pending'
      && normalizePhone(request.identifier) === normalizePhone(phone)
    ));
    return resetPassword(registeredUser.id, matchingRequest?.identifier || phone, registeredUser.id);
  };

  const copyTemporaryPassword = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopyMessage(t.passwordCopied);
    } catch (error) {
      console.error('Temporary password clipboard error:', error);
      setCopyMessage(t.passwordCopyFailed);
    }
  };

  const closePasswordDialog = () => {
    setTemporaryPassword('');
    setCopyMessage('');
  };

  return (
    <section className="mx-auto my-6 max-w-3xl rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-8">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-700">{t.accountSecurity}</p>
      <h1 className="mt-2 text-2xl font-black text-slate-950">{t.userPasswordResets}</h1>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <h2 className="text-lg font-black text-slate-900">{t.recentResetRequests}</h2>
        {requestsError && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{requestsError}</p>}
        {requestsLoading ? (
          <p className="mt-3 text-sm text-slate-500">{t.loadingResetRequests}</p>
        ) : !requestsError && requests.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t.noResetRequests}</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-slate-900">{request.identifier || t.unknownUser}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {request.createdAt?.toDate
                      ? request.createdAt.toDate().toLocaleString(language === 'am' ? 'am-ET' : 'en-US')
                      : t.unknownDate}
                  </p>
                  {resetErrorUserId === request.id && resetError && (
                    <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{resetError}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                    request.status === 'pending'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-200 text-slate-700'
                  }`}>
                    {t[request.status] || request.status || t.unknownStatus}
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(busyUserId)}
                    onClick={() => resetPassword(request.id, request.identifier)}
                    className="min-h-10 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyUserId === request.id ? t.wait : t.resetPassword}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6">
        <label className="block text-sm font-bold text-slate-700">
          {t.searchRegisteredUsers}
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.registeredUserSearchPlaceholder}
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-cyan-500"
          />
        </label>

        {(usersError || entriesError) && (
          <div role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {usersError || entriesError}
          </div>
        )}

        {(usersLoading || entriesLoading) && (
          <p className="mt-3 text-sm text-slate-500">{t.loadingRegisteredUsers}</p>
        )}

        {!usersLoading && !usersError && !search.trim() && (
          <p className="mt-3 text-sm text-slate-500">{t.registeredUserSearchHint}</p>
        )}

        {!usersLoading && !entriesLoading && !usersError && !entriesError && search.trim() && matchingUsers.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">{t.noRegisteredUsers}</p>
        )}

        {matchingUsers.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200">
            {matchingUsers.map((registeredUser) => {
              const numbers = [...(numbersByUser.get(registeredUser.id) || [])];
              return (
                <li key={registeredUser.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-bold text-slate-900">{registeredUser.fullName || t.unknownUser}</p>
                    <p className="mt-1 break-all font-mono text-xs text-slate-600">{registeredUser.phone || '—'}</p>
                    {numbers.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        {t.ticketNumbers}: {numbers.map((number) => `#${number.padStart(3, '0')}`).join(', ')}
                      </p>
                    )}
                    {resetErrorUserId === registeredUser.id && resetError && (
                      <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{resetError}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(busyUserId)}
                    onClick={() => resetRegisteredUserPassword(registeredUser)}
                    className="min-h-11 shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyUserId === registeredUser.id ? t.wait : t.resetPassword}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {temporaryPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="temporary-password-title"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            <h2 id="temporary-password-title" className="text-xl font-black text-slate-950">{t.temporaryPasswordTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t.temporaryPasswordCopy}</p>
            <input
              readOnly
              value={temporaryPassword}
              aria-label={t.temporaryPasswordTitle}
              onFocus={(event) => event.target.select()}
              className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-base font-bold text-slate-900"
            />
            {copyMessage && (
              <p role={copyMessage === t.passwordCopyFailed ? 'alert' : 'status'} className={`mt-3 text-sm font-semibold ${
                copyMessage === t.passwordCopyFailed ? 'text-red-700' : 'text-emerald-700'
              }`}>
                {copyMessage}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closePasswordDialog}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {t.close}
              </button>
              <button
                type="button"
                onClick={copyTemporaryPassword}
                className="rounded-xl bg-cyan-700 px-4 py-3 text-sm font-bold text-white hover:bg-cyan-800"
              >
                {t.copy}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
