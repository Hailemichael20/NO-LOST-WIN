import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebaseConfig'; // Import your firebaseConfig
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

const TIERS = [50, 100, 200, 500];

// Vibrant colors for wheel slices
const SLICE_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', 
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
];

export default function LotteryWheel() {
  const [selectedTier, setSelectedTier] = useState(100);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  
  const [rotationDegree, setRotationDegree] = useState(0);
  const [winner, setWinner] = useState(null);

  const canvasRef = useRef(null);

  // 1. Fetch Approved Participants from Firestore for Selected Tier
  const fetchParticipants = async () => {
    setLoading(true);
    setWinner(null);
    try {
      const q = query(
        collection(db, 'entries'),
        where('tier', '==', selectedTier),
        where('status', '==', 'approved')
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setParticipants(data);
    } catch (err) {
      console.error('Error fetching participants:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParticipants();
  }, [selectedTier]);

  // 2. Draw Wheel Slices on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || participants.length === 0) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(centerX, centerY) - 10;

    const numSlices = participants.length;
    const arcSize = (2 * Math.PI) / numSlices;

    ctx.clearRect(0, 0, width, height);

    participants.forEach((user, i) => {
      const startAngle = i * arcSize;
      const endAngle = startAngle + arcSize;

      // Draw Slice
      ctx.beginPath();
      ctx.fillStyle = SLICE_COLORS[i % SLICE_COLORS.length];
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      // Draw Slice Border
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw Name Text
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(startAngle + arcSize / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(user.fullName || `User ${i + 1}`, radius - 20, 5);
      ctx.restore();
    });

    // Draw Center Peg
    ctx.beginPath();
    ctx.arc(centerX, centerY, 25, 0, 2 * Math.PI);
    ctx.fillStyle = '#1E293B';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  }, [participants]);

  // 3. Trigger Spin Engine
  const spinWheel = () => {
    if (isSpinning || participants.length === 0) return;

    setIsSpinning(true);
    setWinner(null);

    // Pick random index using cryptographically random values
    const randomBuffer = new Uint32Array(1);
    window.crypto.getRandomValues(randomBuffer);
    const selectedIndex = randomBuffer[0] % participants.length;

    const numSlices = participants.length;
    const arcDegree = 360 / numSlices;

    // Calculate angle to land winning slice at the top pointer (270deg / 12 o'clock position)
    const winningSliceMiddle = (selectedIndex * arcDegree) + (arcDegree / 2);
    
    // Total spins = 5 full rotations (1800 deg) + offset to align slice with top indicator
    const extraTurns = 1800;
    const currentRotationMod = rotationDegree % 360;
    const targetDegree = rotationDegree + extraTurns + (360 - winningSliceMiddle) - (currentRotationMod);

    setRotationDegree(targetDegree);

    // Announce Winner after 5s transition finishes
    setTimeout(async () => {
      setIsSpinning(false);
      const winningUser = participants[selectedIndex];
      setWinner(winningUser);

      // Optionally mark winner in Firestore
      try {
        await updateDoc(doc(db, 'entries', winningUser.id), {
          isWinner: true,
          wonAt: new Date()
        });
      } catch (err) {
        console.error('Failed to log winner to database:', err);
      }
    }, 5000);
  };

  return (
    <div className="max-w-xl mx-auto my-8 p-6 bg-slate-900 rounded-3xl shadow-2xl text-white border border-slate-800">
      <h2 className="text-2xl font-black text-center mb-1 text-amber-400 uppercase tracking-wide">
        🎰 Live Lottery Wheel
      </h2>
      <p className="text-slate-400 text-center text-xs mb-6">Select Tier & Spin for Approved Participants</p>

      {/* Tier Selector Tabs */}
      <div className="flex justify-center gap-2 mb-8">
        {TIERS.map(tier => (
          <button
            key={tier}
            disabled={isSpinning}
            onClick={() => setSelectedTier(tier)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
              selectedTier === tier
                ? 'bg-amber-400 text-slate-900 shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {tier} Birr
          </button>
        ))}
      </div>

      {/* Wheel Area */}
      <div className="relative flex flex-col items-center justify-center min-h-[380px]">
        {loading ? (
          <div className="text-slate-400 animate-pulse text-sm">Loading approved participants...</div>
        ) : participants.length === 0 ? (
          <div className="p-8 text-center bg-slate-800/50 rounded-2xl border border-slate-800">
            <p className="text-slate-300 font-semibold mb-1">No Approved Entries</p>
            <p className="text-xs text-slate-500">Approve user receipts for the {selectedTier} Birr tier in the Admin Panel to begin.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Top Wheel Pointer Indicator */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20 w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[24px] border-t-amber-400 drop-shadow-md" />

            {/* Rotatable Wheel Canvas */}
            <div
              style={{
                transform: `rotate(${rotationDegree}deg)`,
                transition: isSpinning ? 'transform 5s cubic-bezier(0.15, 0.99, 0.35, 1)' : 'none',
              }}
              className="rounded-full shadow-2xl overflow-hidden"
            >
              <canvas ref={canvasRef} width={340} height={340} className="block" />
            </div>
          </div>
        )}
      </div>

      {/* Participant Counter & Refresh */}
      <div className="flex justify-between items-center mt-6 px-2 text-xs text-slate-400">
        <span>Approved Candidates: <strong className="text-amber-400">{participants.length}</strong></span>
        <button 
          onClick={fetchParticipants} 
          disabled={isSpinning}
          className="underline hover:text-white transition"
        >
          Refresh List
        </button>
      </div>

      {/* Spin Control Button */}
      <button
        onClick={spinWheel}
        disabled={isSpinning || participants.length === 0}
        className={`w-full mt-6 py-4 rounded-2xl font-black text-lg transition uppercase tracking-wider shadow-xl ${
          isSpinning || participants.length === 0
            ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
            : 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 hover:from-amber-300 hover:to-amber-400 active:scale-[0.98]'
        }`}
      >
        {isSpinning ? 'Spinning Wheel...' : `SPIN FOR ${selectedTier} BIRR WINNER`}
      </button>

      {/* Winner Announcement Popup Modal */}
      {winner && (
        <div className="mt-6 p-5 bg-gradient-to-br from-amber-500/20 to-emerald-500/20 border-2 border-amber-400 rounded-2xl text-center animate-bounce">
          <span className="text-3xl mb-1 block">🎉</span>
          <h3 className="text-xl font-extrabold text-amber-300 uppercase">WINNER SELECTED!</h3>
          <p className="text-2xl font-black text-white mt-1">{winner.fullName}</p>
          <p className="text-sm font-mono text-emerald-400 mt-0.5">{winner.phone}</p>
          <p className="text-xs text-slate-400 mt-2">Category: {winner.tier} Birr Tier</p>
        </div>
      )}
    </div>
  );
}