'use client';

import { useState } from 'react';
import { Ticket, Volume2, Play, CheckCircle, SkipForward, Printer, ArrowLeftRight, Clock, User } from 'lucide-react';
import type { BarberStatus } from '@/lib/operationsTypes';
import { QueueTicketDetailsModal } from './QueueTicketDetailsModal';
import { TransferBarberModal } from './TransferBarberModal';
import { speakQueueTicket } from '@/lib/queueVoice';
import { printQueueTicket } from '@/lib/printQueueTicket';
import type { QueueTicketPrintData } from '@/components/queue/QueueTicketPrint';
import { normalizeQueueTicket, LIVE_STATUSES, type NormalizedQueueTicket } from '@/lib/queueTicketNormalizer';

const TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'النشطة' },
  { key: 'waiting', label: 'منتظر' },
  { key: 'called', label: 'تم النداء' },
  { key: 'in_service', label: 'في الخدمة' },
  { key: 'skipped', label: 'تخطى' },
  { key: 'done', label: 'منجزون' },
];

const STATUS_COLORS: Record<string, string> = {
  waiting: '#F59E0B',
  called: '#3B82F6',
  arrived: '#10B981',
  in_service: '#8B5CF6',
  done: '#6B7280',
  skipped: '#EF4444',
  cancelled: '#6B7280',
  no_show: '#DC2626',
};

const STATUS_LABELS: Record<string, string> = {
  waiting: 'انتظار',
  called: 'تم النداء',
  arrived: 'حضر',
  in_service: 'في الخدمة',
  done: 'انتهى',
  skipped: 'تخطى',
  cancelled: 'ملغي',
  no_show: 'لم يحضر',
};

interface Props {
  tickets: any[];   // accepts raw PascalCase rows from /api/queue
  barbers: BarberStatus[];
  loading: boolean;
  onAction: (ticketId: number, action: string, extra?: any) => Promise<void>;
  onRefresh: () => void;
}

export function LiveQueueColumn({ tickets, barbers, loading, onAction, onRefresh }: Props) {
  const [tab, setTab] = useState<string>('all');
  const [selected, setSelected] = useState<NormalizedQueueTicket | null>(null);
  const [transferTicket, setTransferTicket] = useState<NormalizedQueueTicket | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);

  // Normalize all incoming tickets once (handles both PascalCase and camelCase)
  const normalized = tickets.map(normalizeQueueTicket);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[operations live queue] received', tickets.length, 'raw tickets');
    console.log('[operations live queue] normalized', normalized.map(t => ({
      id: t.queueTicketId, code: t.ticketCode, status: t.status,
      client: t.clientName, barber: t.barberName,
    })));
  }

  // 'all' tab = active statuses only (same as /queue/live LIVE_STATUSES)
  // 'done' tab = done + cancelled + no_show
  const getFiltered = (tabKey: string): NormalizedQueueTicket[] => {
    if (tabKey === 'all') return normalized.filter(t => LIVE_STATUSES.includes(t.status));
    if (tabKey === 'done') return normalized.filter(t => ['done', 'cancelled', 'no_show'].includes(t.status));
    return normalized.filter(t => t.status === tabKey);
  };

  const filtered = getFiltered(tab);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[operations live queue] filtered tab=', tab, 'count=', filtered.length);
  }

  const handleVoice = async (t: NormalizedQueueTicket, e: React.MouseEvent) => {
    e.stopPropagation();
    setSpeaking(t.queueTicketId);
    try {
      await speakQueueTicket({ ticketCode: t.ticketCode, clientName: t.clientName, empName: t.barberName }, { provider: 'azure' });
    } finally { setSpeaking(null); }
  };

  const [printingId, setPrintingId] = useState<number | null>(null);
  const handlePrint = (t: NormalizedQueueTicket) => {
    if (printingId === t.queueTicketId) return; // prevent double-click
    setPrintingId(t.queueTicketId);
    const printData: QueueTicketPrintData = {
      ticketCode: t.ticketCode,
      clientName: t.clientName,
      empName: t.barberName,
      queueDate: t.queueDate,
      createdTime: t.createdTime,
      estimatedWaitMinutes: t.estimatedWaitMinutes ?? undefined,
      estimatedStartTime: t.estimatedStartTime ?? undefined,
    };
    printQueueTicket(printData);
    // Record print on server (non-blocking)
    fetch(`/api/queue/${t.queueTicketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incrementPrintCount: true }),
    }).catch(() => {});
    setTimeout(() => setPrintingId(null), 2000);
  };

  const countForTab = (key: string) => getFiltered(key).length;

  // Waiting count = active statuses
  const waitingCount = normalized.filter(t => LIVE_STATUSES.includes(t.status)).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
        <Ticket size={14} className="text-amber-400" />
        <span className="text-sm font-bold text-white">قائمة الانتظار</span>
        <span className="mr-auto text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
          {waitingCount} نشط
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
        {TABS.map(t => {
          const cnt = countForTab(t.key);
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
              style={{
                background: tab === t.key ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: tab === t.key ? '#F59E0B' : '#6B7280',
                border: `1px solid ${tab === t.key ? 'rgba(245,158,11,0.3)' : 'transparent'}`,
              }}>
              {t.label}{cnt > 0 && <span className="mr-1 opacity-70">({cnt})</span>}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">جاري التحميل...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
            <Ticket size={24} className="mb-2 opacity-30" />
            <p className="text-sm">{normalized.length === 0 ? 'لا توجد تذاكر اليوم' : 'لا توجد تذاكر في هذه الحالة'}</p>
          </div>
        )}
        {filtered.map(t => {
          const color = STATUS_COLORS[t.status] ?? '#6B7280';
          const label = STATUS_LABELS[t.status] ?? t.status;
          const isSpk = speaking === t.queueTicketId;
          const isLive = LIVE_STATUSES.includes(t.status);

          const estTime = t.estimatedStartTime ? (() => {
            const d = new Date(t.estimatedStartTime);
            const h = d.getHours() % 12 || 12;
            const m = String(d.getMinutes()).padStart(2, '0');
            return `${h}:${m} ${d.getHours() < 12 ? 'ص' : 'م'}`;
          })() : null;

          return (
            <div key={t.queueTicketId}
              onClick={() => setSelected(t)}
              className="rounded-xl border p-3 space-y-2 cursor-pointer transition-all hover:border-zinc-600"
              style={{ borderColor: '#2A2A35', background: '#1A1A20', opacity: isLive ? 1 : 0.6 }}>

              {/* Row 1: code + status badge + source badge */}
              <div className="flex items-center justify-between">
                <span className="text-xl font-black" style={{ color: '#D6A84F' }}>{t.ticketCode}</span>
                <div className="flex items-center gap-2">
                  {/* Source/Priority badges */}
                  {t.source === 'booking' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(99,102,241,0.2)', color: '#818CF8', border: '1px solid rgba(99,102,241,0.3)' }}>
                      حجز وصل
                    </span>
                  )}
                  {t.source === 'walk_in' && t.priority === 2 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(245,158,11,0.2)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)' }}>
                      أولوية يدوية
                    </span>
                  )}
                  {t.source === 'walk_in' && t.priority === 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(107,114,128,0.2)', color: '#6B7280', border: '1px solid rgba(107,114,128,0.3)' }}>
                      Walk-in
                    </span>
                  )}
                  {estTime && (
                    <span className="text-xs text-zinc-500 flex items-center gap-1">
                      <Clock size={10} />{estTime}
                    </span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
                    {label}
                  </span>
                </div>
              </div>

              {/* Row 2: client + barber */}
              <div className="flex items-center gap-3 text-xs text-zinc-400">
                <span className="flex items-center gap-1">
                  <User size={10} />
                  {t.clientName !== 'عميل غير محدد' ? t.clientName : <span className="text-zinc-600">غير محدد</span>}
                </span>
                {t.barberName !== '-' && (
                  <span className="flex items-center gap-1">
                    <span style={{ color: '#D6A84F' }}>✂</span>{t.barberName}
                  </span>
                )}
                {t.estimatedWaitMinutes != null && (
                  <span className="flex items-center gap-1 mr-auto"><Clock size={10} />~{t.estimatedWaitMinutes}د</span>
                )}
              </div>

              {/* Row 3: quick actions */}
              {isLive && (
                <div className="flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                  <QuickBtn
                    icon={<Volume2 size={11} />}
                    color={isSpk ? '#EF4444' : '#3B82F6'}
                    label={isSpk ? 'جاري...' : 'نداء'}
                    onClick={e => handleVoice(t, e)}
                  />
                  {['waiting', 'called', 'arrived'].includes(t.status) && (
                    <QuickBtn icon={<Play size={11} />} color="#10B981" label="بدء"
                      onClick={async e => { e.stopPropagation(); await onAction(t.queueTicketId, 'start'); }} />
                  )}
                  {t.status === 'in_service' && (
                    <QuickBtn icon={<CheckCircle size={11} />} color="#D6A84F" label="تم"
                      onClick={async e => { e.stopPropagation(); await onAction(t.queueTicketId, 'done'); }} />
                  )}
                  {['waiting', 'called', 'arrived'].includes(t.status) && (
                    <QuickBtn icon={<SkipForward size={11} />} color="#F97316" label="تخطي"
                      onClick={async e => { e.stopPropagation(); await onAction(t.queueTicketId, 'skip'); }} />
                  )}
                  <QuickBtn icon={<ArrowLeftRight size={11} />} color="#8B5CF6" label="نقل"
                    onClick={e => { e.stopPropagation(); setTransferTicket(t); }} />
                  <QuickBtn icon={<Printer size={11} />} color="#6B7280" label="طباعة"
                    onClick={e => { e.stopPropagation(); handlePrint(t); }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modals — pass _raw so existing modals that expect QueueTicket still work */}
      {selected && (
        <QueueTicketDetailsModal
          ticket={selected._raw}
          onClose={() => { setSelected(null); onRefresh(); }}
          onAction={async (id, action, extra) => { await onAction(id, action, extra); setSelected(null); onRefresh(); }}
          onTransfer={t => { setTransferTicket(normalizeQueueTicket(t)); setSelected(null); }}
          onPrint={raw => handlePrint(normalizeQueueTicket(raw))}
        />
      )}
      {transferTicket && (
        <TransferBarberModal
          ticket={transferTicket._raw}
          barbers={barbers}
          onClose={() => setTransferTicket(null)}
          onTransfer={async (ticketId, newEmpId) => {
            await onAction(ticketId, 'transfer', { newEmpId });
            setTransferTicket(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

function QuickBtn({ icon, color, label, onClick }: { icon: React.ReactNode; color: string; label: string; onClick: (e: React.MouseEvent) => void; }) {
  return (
    <button onClick={onClick}
      title={label}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all hover:opacity-80"
      style={{ background: color + '15', color, border: `1px solid ${color}30` }}>
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
