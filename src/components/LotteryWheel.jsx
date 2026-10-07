import React, { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { translations, translate } from '../translations';
import { isEligibleDrawTicket, MAX_TICKET_NUMBER } from '../../lib/ticket-constants';
import { getWheelAlignmentDegrees } from '../../lib/lottery-wheel';

const TIERS = [50, 100, 200, 500];
const SLICE_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
];

export default function LotteryWheel({ language }) {
  const t = translations[language] || translations.en;
  const [selectedTier, setSelectedTier] = useState(100);
  const [participants, setParticipants] = useState([]);
  const [wheelParticipants, setWheelParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotationDegree, setRotationDegree] = useState(0);
  const [winner, setWinner] = useState(null);
  const [drawEvent, setDrawEvent] = useState(null);
  const canvasRef = useRef(null);
  const participantsRef = useRef([]);
  const drawEventRef = useRef(null);
  const lastDrawIdRef = useRef(null);
  const firstDrawSnapshotRef = useRef(true);
  const rotationDegreeRef = useRef(0);
  const animationTimerRef = useRef(null);

  useEffect(() => {
    let participantsLoaded = false;
    let drawLoaded = false;
    setLoading(true);
    setLoadError('');
    setParticipants([]);
    participantsRef.current = [];
    setWheelParticipants([]);
    setWinner(null);
    setDrawEvent(null);
    drawEventRef.current = null;
    lastDrawIdRef.current = null;
    firstDrawSnapshotRef.current = true;
    rotationDegreeRef.current = 0;
    setRotationDegree(0);
    setIsSpinning(false);
    if (animationTimerRef.current) clearTimeout(animationTimerRef.current);

    const approvedTicketsQuery = query(
      collection(db, 'ticketBoard'),
      where('tier', '==', String(selectedTier)),
      where('status', '==', 'approved'),
      orderBy('number', 'asc'),
    );
    const unsubscribeTickets = onSnapshot(approvedTicketsQuery, (snapshot) => {
      const nextParticipants = snapshot.docs
        .map((ticketDoc) => ({ id: ticketDoc.id, ...ticketDoc.data() }))
        .filter((ticket) => isEligibleDrawTicket(ticket, selectedTier))
        .sort((first, second) => Number(first.number) - Number(second.number));
      participantsRef.current = nextParticipants;
      setParticipants(nextParticipants);
      if (!drawEventRef.current?.frozenNumbers?.length) {
        setWheelParticipants(nextParticipants);
      }
      participantsLoaded = true;
      if (drawLoaded) setLoading(false);
    }, (error) => {
      console.error('Registered number listener error:', {
        code: error.code,
        message: error.message,
      }, error);
      setLoadError(t.registeredNumbersLoadError);
      participantsLoaded = true;
      setLoading(false);
    });

    const latestDrawQuery = query(
      collection(db, 'drawEvents'),
      where('tier', '==', Number(selectedTier)),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    const unsubscribeDraws = onSnapshot(latestDrawQuery, (snapshot) => {
      const latestSnapshot = snapshot.docs[0];
      const latestDraw = latestSnapshot
        ? { id: latestSnapshot.id, ...latestSnapshot.data() }
        : null;
      const isInitialSnapshot = firstDrawSnapshotRef.current;
      firstDrawSnapshotRef.current = false;
      drawLoaded = true;
      if (participantsLoaded) setLoading(false);

      if (!latestDraw) {
        drawEventRef.current = null;
        lastDrawIdRef.current = null;
        setDrawEvent(null);
        setWinner(null);
        setWheelParticipants(participantsRef.current);
        return;
      }
      if (latestDraw.id === lastDrawIdRef.current) return;

      lastDrawIdRef.current = latestDraw.id;
      drawEventRef.current = latestDraw;
      setDrawEvent(latestDraw);
      const frozenNumbers = Array.isArray(latestDraw.frozenNumbers)
        ? latestDraw.frozenNumbers.map(Number).filter((number) => (
          Number.isInteger(number) && number >= 1 && number <= MAX_TICKET_NUMBER
        ))
        : [];
      const ticketsByNumber = new Map(
        participantsRef.current.map((ticket) => [Number(ticket.number), ticket]),
      );
      const frozenParticipants = frozenNumbers.map((number) => (
        ticketsByNumber.get(number) || { number, tier: String(selectedTier) }
      ));
      if (frozenParticipants.length > 0) setWheelParticipants(frozenParticipants);

      const nextWinner = {
        number: Number(latestDraw.winnerNumber),
        tier: Number(latestDraw.tier),
        phoneLast4: latestDraw.winnerPhoneLast4,
      };
      const winningIndex = frozenNumbers.indexOf(nextWinner.number);

      if (isInitialSnapshot || winningIndex < 0 || frozenParticipants.length === 0) {
        setWinner(nextWinner);
        if (winningIndex >= 0) {
          const alignedRotation = rotationDegreeRef.current
            + getWheelAlignmentDegrees(winningIndex, frozenNumbers.length, rotationDegreeRef.current);
          rotationDegreeRef.current = alignedRotation;
          setRotationDegree(alignedRotation);
        }
        return;
      }

      if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
      setWinner(null);
      setIsSpinning(true);
      const targetRotation = rotationDegreeRef.current
        + 1800
        + getWheelAlignmentDegrees(winningIndex, frozenNumbers.length, rotationDegreeRef.current);
      rotationDegreeRef.current = targetRotation;
      setRotationDegree(targetRotation);
      animationTimerRef.current = setTimeout(() => {
        setIsSpinning(false);
        setWinner(nextWinner);
        animationTimerRef.current = null;
      }, 5000);
    }, (error) => {
      console.error('Draw event listener error:', {
        code: error.code,
        message: error.message,
      }, error);
      setLoadError(t.drawEventsLoadError);
      drawLoaded = true;
      setLoading(false);
    });

    return () => {
      unsubscribeTickets();
      unsubscribeDraws();
      if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
    };
  }, [selectedTier, t.drawEventsLoadError, t.registeredNumbersLoadError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || wheelParticipants.length === 0) return;

    const context = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 10;
    const arcSize = (2 * Math.PI) / wheelParticipants.length;
    context.clearRect(0, 0, canvas.width, canvas.height);

    wheelParticipants.forEach((participant, index) => {
      const startAngle = index * arcSize;
      const endAngle = startAngle + arcSize;
      context.beginPath();
      context.fillStyle = SLICE_COLORS[index % SLICE_COLORS.length];
      context.moveTo(centerX, centerY);
      context.arc(centerX, centerY, radius, startAngle, endAngle);
      context.closePath();
      context.fill();
      context.strokeStyle = '#FFFFFF';
      context.lineWidth = 2;
      context.stroke();

      if (arcSize >= 0.12) {
        context.save();
        context.translate(centerX, centerY);
        context.rotate(startAngle + arcSize / 2);
        context.textAlign = 'right';
        context.fillStyle = '#FFFFFF';
        context.font = 'bold 11px sans-serif';
        context.fillText(`#${String(participant.number).padStart(3, '0')}`, radius - 14, 4);
        context.restore();
      }
    });

    context.beginPath();
    context.arc(centerX, centerY, 25, 0, 2 * Math.PI);
    context.fillStyle = '#1E293B';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = '#FFFFFF';
    context.stroke();
  }, [wheelParticipants]);

  return (
    <div className="mx-auto my-8 max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
      <h2 className="mb-1 text-center text-2xl font-black uppercase tracking-wide text-amber-400">
        🎰 {t.lotteryWheel}
      </h2>
      <p className="mb-6 text-center text-xs text-slate-400">{t.liveWheelDescription}</p>

      <div className="mb-8 flex justify-center gap-2">
        {TIERS.map((tier) => (
          <button
            key={tier}
            disabled={isSpinning || loading}
            onClick={() => setSelectedTier(tier)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              selectedTier === tier
                ? 'bg-amber-400 text-slate-900 shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {tier} {t.birr}
          </button>
        ))}
      </div>

      <div className="relative flex min-h-[380px] flex-col items-center justify-center">
        {loading ? (
          <div className="animate-pulse text-sm text-slate-400">{t.loadingParticipants}</div>
        ) : loadError ? (
          <div role="alert" className="rounded-2xl border border-red-900 bg-red-950/40 p-8 text-center">
            <p className="text-sm text-red-200">{loadError}</p>
          </div>
        ) : wheelParticipants.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-800/50 p-8 text-center">
            <p className="mb-1 font-semibold text-slate-300">{t.noApprovedEntries}</p>
            <p className="text-xs text-slate-500">{translate(t.approveToBegin, { tier: `${selectedTier} ${t.birr}` })}</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute -top-3 left-1/2 z-20 h-0 w-0 -translate-x-1/2 border-l-[14px] border-r-[14px] border-t-[24px] border-l-transparent border-r-transparent border-t-amber-400 drop-shadow-md" />
            <div
              style={{
                transform: `rotate(${rotationDegree}deg)`,
                transition: isSpinning ? 'transform 5s cubic-bezier(0.15, 0.99, 0.35, 1)' : 'none',
              }}
              className="overflow-hidden rounded-full shadow-2xl"
            >
              <canvas ref={canvasRef} width={340} height={340} className="block" />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 px-2 text-center text-xs text-slate-400">
        {t.confirmedCandidates}: <strong className="text-amber-400">{participants.length}</strong>
      </div>
      {!drawEvent && participants.length > 0 && (
        <p className="mt-5 text-center text-sm font-semibold text-slate-400">{t.waitingForDraw}</p>
      )}

      {winner && (
        <div className="mt-6 animate-bounce rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-500/20 to-emerald-500/20 p-5 text-center">
          <span className="mb-1 block text-3xl">🎉</span>
          <h3 className="text-xl font-extrabold uppercase text-amber-300">{t.winnerSelected}</h3>
          <p className="mt-1 text-2xl font-black text-white">#{String(winner.number).padStart(3, '0')}</p>
          <p className="mt-0.5 font-mono text-sm text-emerald-400">
            {winner.phoneLast4 ? `••••${winner.phoneLast4}` : t.phoneHidden}
          </p>
          <p className="mt-2 text-xs text-slate-400">{t.category}: {winner.tier} {t.birr}</p>
          {drawEvent?.frozenTicketsHash && (
            <p className="mt-2 break-all text-[10px] text-slate-500">{drawEvent.frozenTicketsHash.slice(0, 12)}</p>
          )}
        </div>
      )}
    </div>
  );
}
