'use client';

import { useState } from 'react';
import {
  Volume2, Play, CheckCircle, SkipForward,
  Printer, ArrowLeftRight, ChevronDown, ChevronUp,
  Clock, User, Scissors,
} from 'lucide-react';
import type { BarberStatus } from '@/lib/operationsTypes';
import type { NormalizedQueueTicket } from '@/lib/queueTicketNormalizer';
import { LIVE_STATUSES } from '@/lib/queueTicketNormalizer';
import { QueueTicketDetailsModal } from './QueueTicketDetailsModal';
import { TransferBarberModal }    from './TransferBarberModal';
import { speakQueueTicket }       from '@/lib/queueVoice';
import { printQueueTicket }       from '@/lib/printQueueTicket';
import { normalizeQueueTicket, normalizedTicketToPrintData }   from '@/lib/queueTicketNormalizer';

// ── constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  waiting:    '#F59E0B',
  called:     '#3B82F6',
  arrived:    '#10B981',
  in_service: '#8B5CF6',
  done:       '#6B7280',
  skipped:    '#EF4444',
  cancelled:  '#6B7280',
};

const STATUS_LABELS: Record<string, string> = {
  waiting:    'انتظار',
  called:     'تم النداء',
  arrived:    'حضر',
  in_service: 'في الخدمة',
  done:       'انتهى',
  skipped:    'تخطى',
  cancelled:  'ملغي',
};

// Sort order within a barber group
const STATUS_ORDER: Record<string, number> = {
  in_service: 0,
  called:     1,
  arrived:    2,
  waiting:    3,
  skipped:    4,
  done:       5,
  cancelled:  6,
};

// ── types ─────────────────────────────────────────────────────────────────────

export interface BarberGroup {
  empId:      number | null;
  barberName: string;
  barber:     BarberStatus | null;
  tickets:    NormalizedQueueTicket[];
}

interface Props {
  group:      BarberGroup;
  allBarbers: BarberStatus[];
  onAction:   (ticketId: number, action: string, extra?: any) => Promise<void>;
  onRefresh:  () => void;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} ${d.getHours() < 12 ? 'ص' : 'م'}`;
}

function sortTickets(tickets: NormalizedQueueTicket[]): NormalizedQueueTicket[] {
  return [...tickets].sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 9;
    const ob = STATUS_ORDER[b.status] ?? 9;
    if (oa !== ob) return oa - ob;
    return a.ticketNumber - b.ticketNumber;
  });
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '؟';
}

// ── QuickBtn ──────────────────────────────────────────────────────────────────

function QuickBtn({ icon, color, label, onClick }: {
  icon: React.ReactNode; color: string; label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all hover:opacity-80"
      style={{ background: color + '18', color, border: `1px solid ${color}35` }}>
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

// ── TicketCard (mirrors LiveQueueColumn card style) ───────────────────────────

interface CardProps {
  ticket:    NormalizedQueueTicket;
  allBarbers: BarberStatus[];
  onAction:  (ticketId: number, action: string, extra?: any) => Promise<void>;
  onRefresh: () => void;
}

function TicketCard({ ticket: t, allBarbers, onAction, onRefresh }: CardProps) {
  const [speaking,       setSpeaking]       = useState(false);
  const [selectedModal,  setSelectedModal]  = useState(false);
  const [transferModal,  setTransferModal]  = useState(false);

  const color  = STATUS_COLORS[t.status] ?? '#6B7280';
  const label  = STATUS_LABELS[t.status] ?? t.status;
  const isLive = LIVE_STATUSES.includes(t.status);

  const estTime = t.estimatedStartTime ? fmtTime(t.estimatedStartTime) : null;

  const handleVoice = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSpeaking(true);
    try { await speakQueueTicket({ ticketCode: t.ticketCode, clientName: t.clientName, empName: t.barberName }, { provider: 'azure' }); }
    finally { setSpeaking(false); }
  };

  const handlePrint = (e: React.MouseEvent) => {
    e.stopPropagation();
    printQueueTicket(normalizedTicketToPrintData(t));
  };

  return (
    <>
      <div
        onClick={() => setSelectedModal(true)}
        className="rounded-xl border p-3 space-y-2 cursor-pointer transition-all hover:border-zinc-600"
        style={{ borderColor: t.status === 'in_service' ? '#8B5CF640' : '#2A2A35', background: '#1A1A20', opacity: isLive ? 1 : 0.55 }}>

        {/* Row 1: code + status */}
        <div className="flex items-center justify-between">
          <span className="text-xl font-black" style={{ color: '#D6A84F' }}>{t.ticketCode}</span>
          <div className="flex items-center gap-2">
            {estTime && (
              <span className="text-xs text-zinc-500 flex items-center gap-1">
                <Clock size={10}/>{estTime}
              </span>
            )}
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
              {label}
            </span>
          </div>
        </div>

        {/* Row 2: client + wait */}
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1">
            <User size={10}/>
            {t.clientName !== 'عميل غير محدد'
              ? t.clientName
              : <span className="text-zinc-600">غير محدد</span>}
          </span>
          {t.clientPhone && (
            <span className="text-zinc-600 text-[10px]">{t.clientPhone}</span>
          )}
          {t.estimatedWaitMinutes != null && (
            <span className="flex items-center gap-1 mr-auto text-zinc-500">
              <Clock size={10}/>~{t.estimatedWaitMinutes}د
            </span>
          )}
        </div>

        {/* Row 3: actions */}
        {isLive && (
          <div className="flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
            <QuickBtn icon={<Volume2 size={11}/>} color={speaking ? '#EF4444' : '#3B82F6'}
              label={speaking ? 'جاري...' : 'نداء'} onClick={handleVoice}/>
            {['waiting','called','arrived'].includes(t.status) && (
              <QuickBtn icon={<Play size={11}/>} color="#10B981" label="بدء"
                onClick={async e => { e.stopPropagation(); await onAction(t.queueTicketId, 'start'); onRefresh(); }}/>
            )}
            {t.status === 'in_service' && (
              <QuickBtn icon={<CheckCircle size={11}/>} color="#D6A84F" label="تم"
                onClick={async e => { e.stopPropagation(); await onAction(t.queueTicketId, 'done'); onRefresh(); }}/>
            )}
            {['waiting','called','arrived'].includes(t.status) && (
              <QuickBtn icon={<SkipForward size={11}/>} color="#F97316" label="تخطي"
                onClick={async e => { e.stopPropagation(); await onAction(t.queueTicketId, 'skip'); onRefresh(); }}/>
            )}
            <QuickBtn icon={<ArrowLeftRight size={11}/>} color="#8B5CF6" label="نقل"
              onClick={e => { e.stopPropagation(); setTransferModal(true); }}/>
            <QuickBtn icon={<Printer size={11}/>} color="#6B7280" label="طباعة"
              onClick={handlePrint}/>
          </div>
        )}
      </div>

      {selectedModal && (
        <QueueTicketDetailsModal
          ticket={t._raw}
          onClose={() => { setSelectedModal(false); onRefresh(); }}
          onAction={async (id, action, extra) => { await onAction(id, action, extra); setSelectedModal(false); onRefresh(); }}
          onTransfer={raw => { setTransferModal(true); setSelectedModal(false); }}
          onPrint={raw => printQueueTicket(normalizedTicketToPrintData(normalizeQueueTicket(raw)))}
        />
      )}
      {transferModal && (
        <TransferBarberModal
          ticket={t._raw}
          barbers={allBarbers}
          onClose={() => setTransferModal(false)}
          onTransfer={async (ticketId, newEmpId) => {
            await onAction(ticketId, 'transfer', { newEmpId });
            setTransferModal(false);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

// ── BarberQueueGroup ──────────────────────────────────────────────────────────

export function BarberQueueGroup({ group, allBarbers, onAction, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const sorted       = sortTickets(group.tickets);
  const inService    = sorted.find(t => t.status === 'in_service') ?? null;
  const activeCount  = sorted.filter(t => LIVE_STATUSES.includes(t.status)).length;
  const nextTicket   = sorted.find(t => ['waiting','called','arrived'].includes(t.status)) ?? null;

  // Barber availability badge
  const b = group.barber;
  let availBadge = { label: 'غير محدد', color: '#6B7280' };
  if (b) {
    if (!b.IsAvailable) {
      availBadge = { label: b.AvailabilityReason ?? 'غير متاح', color: '#EF4444' };
    } else if (inService) {
      availBadge = { label: 'مشغول', color: '#8B5CF6' };
    } else {
      availBadge = { label: 'متاح', color: '#10B981' };
    }
  }

  return (
    <div className="rounded-xl border flex flex-col flex-shrink-0 min-w-[230px] max-w-[280px]"
      style={{ borderColor: '#2A2A35', background: '#141418' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none border-b"
        style={{ borderColor: '#2A2A35' }}
        onClick={() => setCollapsed(c => !c)}>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: '#D6A84F22', color: '#D6A84F', border: '1px solid #D6A84F33' }}>
          {initials(group.barberName)}
        </div>

        {/* Name + badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white truncate">{group.barberName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{ background: availBadge.color + '20', color: availBadge.color }}>
              {availBadge.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
            <span className="flex items-center gap-0.5">
              <Scissors size={9}/>{activeCount} دور
            </span>
            {inService && (
              <span className="text-purple-400">الحالي: {inService.ticketCode}</span>
            )}
            {!inService && nextTicket && (
              <span className="text-amber-400/70">التالي: {nextTicket.ticketCode}</span>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <div className="text-zinc-600">
          {collapsed ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
        </div>
      </div>

      {/* ── Tickets ── */}
      {!collapsed && (
        <div className="p-2 space-y-2 overflow-y-auto" style={{ maxHeight: '420px' }}>
          {sorted.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-4">لا توجد أدوار حالياً</p>
          ) : (
            sorted.map(t => (
              <TicketCard
                key={t.queueTicketId}
                ticket={t}
                allBarbers={allBarbers}
                onAction={onAction}
                onRefresh={onRefresh}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
