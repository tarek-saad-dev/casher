'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Play, CheckCircle2, SkipForward, XCircle, PhoneCall,
  ArrowLeftRight, Clock, User, RefreshCw, Plus, CalendarDays,
  AlertCircle, Loader2, Volume2,
} from 'lucide-react';
import { speakQueueTicket, stopQueueSpeech } from '@/lib/queueVoice';
import type { QueueVoiceOptions } from '@/lib/queueVoice';

// ─── Types ────────────────────────────────────────────────────────────────────
type TicketStatus = 'waiting' | 'called' | 'arrived' | 'in_service' | 'done' | 'skipped' | 'cancelled' | 'no_show';

interface Ticket {
  QueueTicketID: number;
  TicketCode: string;
  TicketNumber: number;
  TicketPrefix: string;
  ClientID: number | null;
  EmpID: number | null;
  BookingID: number | null;
  QueueDate: string;
  CreatedTime: string;
  Status: TicketStatus;
  Source: string;
  Priority: number;
  CalledAt: string | null;
  ArrivedAt: string | null;
  ServiceStartedAt: string | null;
  ServiceEndedAt: string | null;
  ClientName: string | null;
  ClientMobile: string | null;
  EmpName: string | null;
  Notes: string | null;
}

interface Barber {
  EmpID: number;
  EmpName: string;
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<TicketStatus, { label: string; color: string; bg: string; dot: string }> = {
  waiting:    { label: 'انتظار',    color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',   dot: '#F59E0B' },
  called:     { label: 'تم النداء', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',   dot: '#3B82F6' },
  arrived:    { label: 'حضر',       color: '#10B981', bg: 'rgba(16,185,129,0.12)',   dot: '#10B981' },
  in_service: { label: 'في الخدمة', color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)',  dot: '#8B5CF6' },
  done:       { label: 'انتهى',     color: '#6B7280', bg: 'rgba(107,114,128,0.10)', dot: '#6B7280' },
  skipped:    { label: 'تخطى',      color: '#EF4444', bg: 'rgba(239,68,68,0.10)',   dot: '#EF4444' },
  cancelled:  { label: 'ملغي',      color: '#6B7280', bg: 'rgba(107,114,128,0.08)', dot: '#6B7280' },
  no_show:    { label: 'لم يحضر',   color: '#DC2626', bg: 'rgba(220,38,38,0.10)',   dot: '#DC2626' },
};

const LIVE_STATUSES: TicketStatus[] = ['waiting', 'called', 'arrived', 'in_service', 'skipped'];
const DONE_STATUSES: TicketStatus[] = ['done', 'cancelled', 'no_show'];

// ─── Action helpers ────────────────────────────────────────────────────────────
function getActions(status: TicketStatus): { action: string; label: string; icon: React.ReactNode; color: string }[] {
  const acts = [];
  if (status === 'waiting' || status === 'skipped') {
    acts.push({ action: 'called',     label: 'نداء',          icon: <PhoneCall size={13} />, color: '#3B82F6' });
    acts.push({ action: 'in_service', label: 'بدء الخدمة',    icon: <Play size={13} />,      color: '#8B5CF6' });
  }
  if (status === 'called') {
    acts.push({ action: 'arrived',    label: 'حضر',           icon: <User size={13} />,      color: '#10B981' });
    acts.push({ action: 'in_service', label: 'بدء الخدمة',    icon: <Play size={13} />,      color: '#8B5CF6' });
    acts.push({ action: 'skipped',    label: 'تخطى',          icon: <SkipForward size={13}/>, color: '#EF4444' });
  }
  if (status === 'arrived') {
    acts.push({ action: 'in_service', label: 'بدء الخدمة',    icon: <Play size={13} />,      color: '#8B5CF6' });
  }
  if (status === 'in_service') {
    acts.push({ action: 'done',       label: 'انتهى',         icon: <CheckCircle2 size={13}/>,color: '#10B981' });
  }
  // Transfer always available for active
  if (LIVE_STATUSES.includes(status)) {
    acts.push({ action: 'transfer',   label: 'نقل حلاق',      icon: <ArrowLeftRight size={13}/>, color: '#F59E0B' });
    acts.push({ action: 'cancelled',  label: 'إلغاء',         icon: <XCircle size={13}/>,    color: '#EF4444' });
  }
  return acts;
}

// ─── Transfer modal ────────────────────────────────────────────────────────────
function TransferModal({
  ticket, barbers, onConfirm, onClose,
}: {
  ticket: Ticket; barbers: Barber[];
  onConfirm: (empId: number) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="rounded-2xl border p-6 w-80 shadow-2xl"
        style={{ background: '#1A1A20', borderColor: '#2A2A35' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-white mb-1">نقل إلى حلاق آخر</h3>
        <p className="text-xs text-zinc-400 mb-4">تذكرة: <span className="text-amber-400 font-bold">{ticket.TicketCode}</span> — {ticket.ClientName || 'عميل غير معروف'}</p>
        <div className="flex flex-col gap-2 mb-4 max-h-48 overflow-y-auto">
          {barbers.filter(b => b.EmpID !== ticket.EmpID).map(b => (
            <button
              key={b.EmpID}
              onClick={() => setSelected(b.EmpID)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl border text-right transition-all"
              style={{
                background: selected === b.EmpID ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
                borderColor: selected === b.EmpID ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.08)',
                color: selected === b.EmpID ? '#F59E0B' : '#D1D5DB',
              }}
            >
              <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white">
                {b.EmpName.charAt(0)}
              </div>
              <span className="text-sm">{b.EmpName}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
            style={{ background: selected ? '#F59E0B' : '#333', color: selected ? '#000' : '#888' }}
          >تأكيد النقل</button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-zinc-400 hover:text-white border border-zinc-700">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ─── Ticket card ───────────────────────────────────────────────────────────────
function TicketCard({
  ticket, barbers, onAction, loading,
}: {
  ticket: Ticket; barbers: Barber[];
  onAction: (id: number, action: string, extra?: Record<string, unknown>) => void;
  loading: boolean;
}) {
  const [showTransfer, setShowTransfer] = useState(false);
  const [speaking,     setSpeaking]     = useState(false);
  const [voiceError,   setVoiceError]   = useState<string | null>(null);
  const cfg = STATUS_CONFIG[ticket.Status] ?? STATUS_CONFIG.waiting;
  const actions = getActions(ticket.Status);
  const isDone = DONE_STATUSES.includes(ticket.Status);

  const elapsedMin = ticket.ServiceStartedAt
    ? Math.floor((Date.now() - new Date(ticket.ServiceStartedAt).getTime()) / 60000)
    : ticket.CalledAt
      ? Math.floor((Date.now() - new Date(ticket.CalledAt).getTime()) / 60000)
      : null;

  const handleVoice = async () => {
    if (speaking) { stopQueueSpeech(); setSpeaking(false); return; }
    setVoiceError(null);
    setSpeaking(true);
    try {
      const opts: QueueVoiceOptions = { provider: 'azure' };
      await speakQueueTicket({
        TicketCode: ticket.TicketCode,
        ClientName: ticket.ClientName,
        EmpName:    ticket.EmpName,
      }, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NO_SPEECH_SYNTHESIS' || msg === 'BOTH_FAILED') {
        setVoiceError('تعذر تشغيل النداء الصوتي');
        setTimeout(() => setVoiceError(null), 3500);
      } else {
        setVoiceError('تعذر تشغيل النداء الصوتي الاحترافي');
        setTimeout(() => setVoiceError(null), 3500);
      }
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <>
      <div
        className="rounded-xl border transition-all"
        style={{
          background: cfg.bg,
          borderColor: isDone ? 'rgba(255,255,255,0.05)' : `rgba(${cfg.dot.replace('#','').match(/.{2}/g)?.map(h=>parseInt(h,16)).join(',')},0.35)`,
          opacity: isDone ? 0.55 : 1,
        }}
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <span
              className="text-xl font-black tracking-tight"
              style={{ color: cfg.color, textShadow: `0 0 18px ${cfg.color}66` }}
            >{ticket.TicketCode}</span>
            {ticket.Priority > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">أولوية</span>
            )}
            {ticket.Source === 'booking' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">حجز</span>
            )}
          </div>
          <span
            className="text-[11px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}44` }}
          >{cfg.label}</span>
        </div>

        {/* Client info */}
        <div className="px-3 pb-2">
          <p className="text-sm font-semibold text-white leading-tight">
            {ticket.ClientName || <span className="text-zinc-500">عميل غير محدد</span>}
          </p>
          {ticket.ClientMobile && (
            <p className="text-[11px] text-zinc-500 mt-0.5">{ticket.ClientMobile}</p>
          )}
        </div>

        {/* Timer */}
        {elapsedMin !== null && !isDone && (
          <div className="px-3 pb-2 flex items-center gap-1.5">
            <Clock size={11} className="text-zinc-500" />
            <span className="text-[11px] text-zinc-400">{elapsedMin} دقيقة</span>
          </div>
        )}

        {/* Actions */}
        {!isDone && (
          <div className="px-3 pb-3 flex flex-wrap gap-1.5">
            {actions.map(act => (
              act.action === 'transfer' ? (
                <button
                  key={act.action}
                  onClick={() => setShowTransfer(true)}
                  disabled={loading}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all disabled:opacity-40"
                  style={{ color: act.color, borderColor: `${act.color}44`, background: `${act.color}11` }}
                >
                  {act.icon}{act.label}
                </button>
              ) : (
                <button
                  key={act.action}
                  onClick={() => onAction(ticket.QueueTicketID, act.action)}
                  disabled={loading}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all disabled:opacity-40"
                  style={{ color: act.color, borderColor: `${act.color}44`, background: `${act.color}11` }}
                >
                  {act.icon}{act.label}
                </button>
              )
            ))}

            {/* Voice announcement button — never changes ticket status */}
            <button
              onClick={handleVoice}
              disabled={loading}
              title={speaking ? 'إيقاف النداء' : 'نداء صوتي'}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all disabled:opacity-40"
              style={speaking
                ? { color: '#EF4444', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)' }
                : { color: '#A78BFA', borderColor: 'rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.08)' }
              }
            >
              {speaking
                ? <><Loader2 size={11} className="animate-spin" /> جاري النداء...</>
                : <><Volume2 size={12} /> نداء</>
              }
            </button>

            {/* Inline voice error */}
            {voiceError && (
              <span className="text-[10px] text-red-400 w-full mt-0.5">{voiceError}</span>
            )}
          </div>
        )}
      </div>

      {showTransfer && (
        <TransferModal
          ticket={ticket}
          barbers={barbers}
          onConfirm={(empId) => { onAction(ticket.QueueTicketID, 'transfer', { transferEmpId: empId }); setShowTransfer(false); }}
          onClose={() => setShowTransfer(false)}
        />
      )}
    </>
  );
}

// ─── Barber column ────────────────────────────────────────────────────────────
function BarberColumn({
  barber, tickets, barbers, onAction, loadingId,
}: {
  barber: Barber; tickets: Ticket[]; barbers: Barber[];
  onAction: (id: number, action: string, extra?: Record<string, unknown>) => void;
  loadingId: number | null;
}) {
  const live = tickets.filter(t => LIVE_STATUSES.includes(t.Status));
  const done = tickets.filter(t => DONE_STATUSES.includes(t.Status));
  const current = tickets.find(t => t.Status === 'in_service');

  return (
    <div
      className="rounded-2xl border flex flex-col min-w-[260px] flex-shrink-0"
      style={{ background: '#141418', borderColor: '#2A2A35', width: 280 }}
    >
      {/* Barber header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: '#2A2A35' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black"
              style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
            >
              {barber.EmpName.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-white">{barber.EmpName}</p>
              <p className="text-[11px] text-zinc-500">
                {live.length} في الانتظار · {done.length} انتهى
              </p>
            </div>
          </div>
          {current && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 animate-pulse">
              في الخدمة
            </span>
          )}
        </div>
      </div>

      {/* Live queue */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-luxury-v" style={{ maxHeight: 580 }}>
        {live.length === 0 && done.length === 0 && (
          <div className="text-center py-8 text-zinc-600 text-sm">لا توجد تذاكر اليوم</div>
        )}
        {live.map(t => (
          <TicketCard
            key={t.QueueTicketID}
            ticket={t}
            barbers={barbers}
            onAction={onAction}
            loading={loadingId === t.QueueTicketID}
          />
        ))}
        {done.length > 0 && (
          <>
            <div className="text-[11px] text-zinc-600 pt-1 pb-0.5 font-medium">المنجزون ({done.length})</div>
            {done.map(t => (
              <TicketCard
                key={t.QueueTicketID}
                ticket={t}
                barbers={barbers}
                onAction={onAction}
                loading={loadingId === t.QueueTicketID}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Unassigned column ─────────────────────────────────────────────────────────
function UnassignedColumn({
  tickets, barbers, onAction, loadingId,
}: {
  tickets: Ticket[]; barbers: Barber[];
  onAction: (id: number, action: string, extra?: Record<string, unknown>) => void;
  loadingId: number | null;
}) {
  if (!tickets.length) return null;
  return (
    <div
      className="rounded-2xl border flex flex-col min-w-[260px] flex-shrink-0"
      style={{ background: '#141418', borderColor: '#2A2A35', width: 280 }}
    >
      <div className="px-4 py-3 border-b" style={{ borderColor: '#2A2A35' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-zinc-800 border border-zinc-700">
            <AlertCircle size={16} className="text-zinc-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-zinc-400">غير محدد الحلاق</p>
            <p className="text-[11px] text-zinc-600">{tickets.length} تذكرة</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-luxury-v" style={{ maxHeight: 580 }}>
        {tickets.map(t => (
          <TicketCard key={t.QueueTicketID} ticket={t} barbers={barbers} onAction={onAction} loading={loadingId === t.QueueTicketID} />
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function QueueLivePage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filterStatus, setFilterStatus] = useState<string>('active');

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  const fetchData = useCallback(async () => {
    try {
      const [tRes, bRes] = await Promise.all([
        fetch(`/api/queue?date=${today}`),
        fetch('/api/employees'),
      ]);
      const tData = await tRes.json();
      const bData = await bRes.json();
      const tickets = tData.tickets || [];
      if (process.env.NODE_ENV !== 'production') {
        console.log('[queue live] tickets', tickets.map((t: any) => ({ id: t.QueueTicketID, code: t.TicketCode, status: t.Status, date: t.QueueDate })));
      }
      setTickets(tickets);
      setBarbers(Array.isArray(bData) ? bData.filter((b: Barber & { isActive?: number }) => b.isActive !== 0) : []);
      setLastRefresh(new Date());
      setError(null);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleAction = async (id: number, action: string, extra: Record<string, unknown> = {}) => {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || 'فشل تحديث الحالة');
        return;
      }
      await fetchData();
    } finally {
      setLoadingId(null);
    }
  };

  // Group tickets by barber
  const grouped = new Map<number | null, Ticket[]>();
  const filteredTickets = filterStatus === 'active'
    ? tickets.filter(t => LIVE_STATUSES.includes(t.Status))
    : filterStatus === 'done'
      ? tickets.filter(t => DONE_STATUSES.includes(t.Status))
      : tickets;

  for (const t of filteredTickets) {
    const key = t.EmpID;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  const waitingCount   = tickets.filter(t => t.Status === 'waiting').length;
  const inServiceCount = tickets.filter(t => t.Status === 'in_service').length;
  const doneCount      = tickets.filter(t => t.Status === 'done').length;

  return (
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-lg font-black text-white tracking-tight">لوحة الانتظار المباشرة</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            آخر تحديث: {lastRefresh.toLocaleTimeString('ar-EG')} — {today}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Stats */}
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 font-semibold">
              {waitingCount} ينتظر
            </span>
            <span className="text-xs px-3 py-1.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/25 font-semibold">
              {inServiceCount} في الخدمة
            </span>
            <span className="text-xs px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-semibold">
              {doneCount} انتهى
            </span>
          </div>
          <button
            onClick={fetchData}
            className="p-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all"
            title="تحديث"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => router.push('/queue/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
          >
            <Plus size={15} />
            تذكرة جديدة
          </button>
          <button
            onClick={() => router.push('/bookings/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 transition-all"
          >
            <CalendarDays size={15} />
            حجز جديد
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800 shrink-0">
        {[
          { key: 'active', label: 'النشطون' },
          { key: 'done',   label: 'المنجزون' },
          { key: 'all',    label: 'الكل'     },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterStatus(tab.key)}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold border transition-all"
            style={filterStatus === tab.key
              ? { background: 'rgba(214,168,79,0.15)', color: '#D6A84F', borderColor: 'rgba(214,168,79,0.4)' }
              : { background: 'transparent', color: '#6B7280', borderColor: '#2A2A35' }
            }
          >{tab.label}</button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-amber-400" size={32} />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="text-red-400 mx-auto mb-3" size={32} />
            <p className="text-red-400 font-semibold">{error}</p>
            <button onClick={fetchData} className="mt-3 text-xs text-zinc-400 underline">إعادة المحاولة</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-luxury">
          <div className="flex gap-4 p-6 h-full" style={{ minWidth: 'max-content', alignItems: 'flex-start' }}>
            {/* Unassigned */}
            <UnassignedColumn
              tickets={grouped.get(null) || []}
              barbers={barbers}
              onAction={handleAction}
              loadingId={loadingId}
            />

            {/* Per-barber columns */}
            {barbers.map(b => {
              const bTickets = grouped.get(b.EmpID) || [];
              if (!bTickets.length && filterStatus !== 'all') return null;
              return (
                <BarberColumn
                  key={b.EmpID}
                  barber={b}
                  tickets={filterStatus === 'all' ? (grouped.get(b.EmpID) || []) : bTickets}
                  barbers={barbers}
                  onAction={handleAction}
                  loadingId={loadingId}
                />
              );
            })}

            {barbers.length === 0 && !grouped.get(null)?.length && (
              <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
                لا توجد بيانات لهذا اليوم
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
