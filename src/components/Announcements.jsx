import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { translations } from '../translations';

export default function Announcements({ language }) {
  const [announcement, setAnnouncement] = useState(null);
  const t = translations[language] || translations.en;

  useEffect(() => onSnapshot(doc(db, 'settings', 'announcement'), (snapshot) => {
    setAnnouncement(snapshot.exists() && snapshot.data().published ? snapshot.data() : null);
  }, (error) => {
    console.error('Announcement load error:', error);
  }), []);

  const title = language === 'am'
    ? announcement?.titleAm || announcement?.titleEn
    : announcement?.titleEn || announcement?.titleAm;
  const message = language === 'am'
    ? announcement?.bodyAm || announcement?.bodyEn
    : announcement?.bodyEn || announcement?.bodyAm;

  const hasContent = Boolean(title || message);

  return (
    <details className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white text-left shadow-sm">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-bold text-slate-700 marker:hidden">
        <div className="flex items-center gap-2">
          <span className="text-amber-500">▾</span>
          <span>{t.announcement}</span>
        </div>

        {/* Circled Red Notification Badge */}
        {hasContent && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white shadow-sm">
            1
          </span>
        )}
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">
        {hasContent
          ? <><h2 className="font-bold text-slate-900">{title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{message}</p></>
          : <p className="text-sm text-slate-500">{t.announcementHidden}</p>}
      </div>
    </details>
  );
}