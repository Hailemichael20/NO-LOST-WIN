import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig'; // Import your firebaseConfig
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc,
  orderBy 
} from 'firebase/firestore';

const TIERS = ['all', 50, 100, 300, 500];
const STATUSES = ['pending', 'approved', 'rejected'];

export default function AdminDashboard() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [tierFilter, setTierFilter] = useState('all');
  const [activeReceiptUrl, setActiveReceiptUrl] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);

  // 1. Fetch Entries in Real-Time
  useEffect(() => {
    setLoading(true);
    let q = query(
      collection(db, 'entries'),
      where('status', '==', statusFilter),
      orderBy('createdAt', 'desc')
    );

    // Listen for live Firestore updates
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Filter locally by Tier if selected
      if (tierFilter !== 'all') {
        docs = docs.filter(item => item.tier === Number(tierFilter));
      }

      setEntries(docs);
      setLoading(false);
    }, (error) => {
      console.error("Firestore listener error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [statusFilter, tierFilter]);

  // 2. Approve or Reject Entry Status
  const handleUpdateStatus = async (id, newStatus) => {
    setUpdatingId(id);
    try {
      const entryRef = doc(db, 'entries', id);
      await updateDoc(entryRef, {
        status: newStatus,
        reviewedAt: new Date()
      });
    } catch (err) {
      console.error(`Failed to update status to ${newStatus}:`, err);
      alert("Error updating status. Check connection.");
    } finally {
      setUpdatingId(null);
    }
  };

  // 3. Delete Entry
  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to permanently delete this record?")) return;
    try {
      await deleteDoc(doc(db, 'entries', id));
    } catch (err) {
      console.error("Failed to delete record:", err);
    }
  };

  return (
    <div className="max-w-6xl mx-auto my-8 p-6 bg-slate-50 min-h-screen rounded-3xl border border-gray-200">
      {/* Header & Quick Stats */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Admin Verification Center</h1>
          <p className="text-sm text-gray-500 mt-1">Verify payment receipts and manage participant entries</p>
        </div>
        
        <div className="flex gap-3">
          <div className="bg-white px-4 py-2.5 rounded-2xl border border-gray-200 shadow-sm text-center">
            <span className="block text-xs uppercase font-bold text-gray-400">Viewing Pool</span>
            <span className="text-xl font-extrabold text-blue-600">{entries.length} Entries</span>
          </div>
        </div>
      </div>

      {/* Control Toolbar (Status & Tier Filters) */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 mb-6 flex flex-wrap justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-xs font-bold capitalize transition ${
                statusFilter === status
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Tier Filter dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold uppercase text-gray-500">Tier:</label>
          <div className="flex gap-1.5">
            {TIERS.map((tier) => (
              <button
                key={tier}
                onClick={() => setTierFilter(tier)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  tierFilter === tier
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tier === 'all' ? 'All' : `${tier} Birr`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Data Table / List */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse font-medium">Loading submissions...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 text-gray-400">
          No <span className="font-bold text-gray-700">{statusFilter}</span> entries found for selected filter.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Participant</th>
                  <th className="py-3.5 px-4">Tier</th>
                  <th className="py-3.5 px-4">Receipt Screenshot</th>
                  <th className="py-3.5 px-4">Submitted At</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50/80 transition">
                    {/* Participant Details */}
                    <td className="py-4 px-4">
                      <div className="font-bold text-gray-900">{entry.fullName}</div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">{entry.phone}</div>
                    </td>

                    {/* Tier Tag */}
                    <td className="py-4 px-4">
                      <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {entry.tier} Birr
                      </span>
                    </td>

                    {/* Receipt Preview Thumbnail */}
                    <td className="py-4 px-4">
                      {entry.receiptUrl ? (
                        <button
                          onClick={() => setActiveReceiptUrl(entry.receiptUrl)}
                          className="relative group w-16 h-12 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 block"
                        >
                          <img 
                            src={entry.receiptUrl} 
                            alt="Receipt" 
                            className="w-full h-full object-cover group-hover:scale-105 transition"
                          />
                          <span className="absolute inset-0 bg-black/30 flex items-center justify-center text-[10px] text-white font-bold opacity-0 group-hover:opacity-100 transition">
                            View
                          </span>
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 italic">No receipt</span>
                      )}
                    </td>

                    {/* Submission Time */}
                    <td className="py-4 px-4 text-xs text-gray-500">
                      {entry.createdAt?.toDate ? entry.createdAt.toDate().toLocaleString() : 'Just now'}
                    </td>

                    {/* Action Buttons */}
                    <td className="py-4 px-4 text-right space-x-2">
                      {statusFilter === 'pending' && (
                        <>
                          <button
                            disabled={updatingId === entry.id}
                            onClick={() => handleUpdateStatus(entry.id, 'approved')}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
                          >
                            Approve
                          </button>
                          <button
                            disabled={updatingId === entry.id}
                            onClick={() => handleUpdateStatus(entry.id, 'rejected')}
                            className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {statusFilter === 'approved' && (
                        <button
                          disabled={updatingId === entry.id}
                          onClick={() => handleUpdateStatus(entry.id, 'rejected')}
                          className="px-3 py-1.5 bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-lg text-xs font-bold transition"
                        >
                          Revoke Approval
                        </button>
                      )}

                      {statusFilter === 'rejected' && (
                        <button
                          disabled={updatingId === entry.id}
                          onClick={() => handleUpdateStatus(entry.id, 'approved')}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold transition"
                        >
                          Re-approve
                        </button>
                      )}

                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="px-2 py-1.5 text-gray-400 hover:text-red-600 transition text-xs"
                        title="Delete record"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Resolution Receipt Image Modal */}
      {activeReceiptUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-4 overflow-hidden relative shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-gray-800 text-sm">Payment Receipt Verification</h3>
              <button
                onClick={() => setActiveReceiptUrl(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto bg-gray-900 rounded-xl flex items-center justify-center p-2">
              <img 
                src={activeReceiptUrl} 
                alt="Enlarged Receipt" 
                className="max-w-full max-h-[65vh] object-contain rounded"
              />
            </div>

            <div className="mt-4 flex justify-between items-center text-xs text-gray-500">
              <span>Tip: Verify transaction ID & date carefully.</span>
              <a 
                href={activeReceiptUrl} 
                target="_blank" 
                rel="noreferrer" 
                className="text-blue-600 font-bold underline"
              >
                Open Original Image
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}