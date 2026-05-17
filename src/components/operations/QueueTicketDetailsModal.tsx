'use client';

import { X, Printer, Volume2, VolumeX, ArrowLeftRight, Play, CheckCircle, SkipForward, XCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { QueueTicket } from '@/lib/operationsTypes';
import { QUEUE_STATUS_LABELS, QUEUE_STATUS_COLORS } from '@/lib/operationsTypes';
import { speakQueueTicket, stopQueueSpeech } from '@/lib/queueVoice';

interface Props {
  ticket:    QueueTicket;
  onClose:   () => void;
  onAction:  (ticketId: number, action: string, extra?: any) => Promise<void>;
  onTransfer: (ticket: QueueTicket) => void;
  onPrint:   (ticket: QueueTicket) => void;
}

export function QueueTicketDetailsModal({ ticket, onClose, onAction, onTransfer, onPrint }: Props) {
  const [loading,  setLoading]  = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const act = async (action: string, extra?: any) => {
    setLoading(action);
    try { await onAction(ticket.QueueTicketID, action, extra); }
    finally { setLoading(null); }
  };

  const handleSpeak = async () => {
    setSpeaking(true);
    try {
      await speakQueueTicket({ ticketCode: ticket.TicketCode, clientName: ticket.ClientName, empName: ticket.EmpName }, { provider: 'azure' });
    } finally { setSpeaking(false); }
  };

  const color = QUEUE_STATUS_COLORS[ticket.Status] ?? '#6B7280';
  const label = QUEUE_STATUS_LABELS[ticket.Status] ?? ticket.Status;

  const estTime = ticket.EstimatedStartTime ? (() => {
    const d = new Date(ticket.EstimatedStartTime);
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2,'0');
    return `${h}:${m} ${d.getHours() < 12 ? 'ص' : 'م'}`;
  })() : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="relative rounded-2xl border shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        style={{ background: '#141418', borderColor: '#2A2A35' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#2A2A35' }}>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-black" style={{ color: '#D6A84F' }}>{ticket.TicketCode}</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: color + '22', color, border: `1px solid ${color}44` }}>{label}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {[
            ['العميل',       ticket.ClientName ?? '—'],
            ['الحلاق',       ticket.EmpName    ?? '—'],
            ['أُنشئ',        ticket.CreatedTime?.slice(0,5) ?? '—'],
            ['الانتظار',     ticket.EstimatedWaitMinutes != null ? `${ticket.EstimatedWaitMinutes} دقيقة` : '—'],
            ['الدخول المتوقع', estTime ?? '—'],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between text-sm">
              <span className="text-zinc-500">{l}</span>
              <span className="text-white font-medium">{v}</span>
            </div>
          ))}
          {ticket.Notes && (
            <div className="pt-1 text-xs text-zinc-400 bg-zinc-900 rounded-lg px-3 py-2">{ticket.Notes}</div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          {/* Voice — never changes status */}
          <Btn
            icon={speaking ? <VolumeX size={14}/> : <Volume2 size={14}/>}
            label={speaking ? 'إيقاف' : 'نداء صوتي'}
            color={speaking ? '#EF4444' : '#3B82F6'}
            onClick={speaking ? () => { stopQueueSpeech(); setSpeaking(false); } : handleSpeak}
          />
          <Btn icon={<Printer size={14}/>} label="طباعة" color="#6B7280" onClick={() => onPrint(ticket)} />

          {ticket.Status === 'waiting' && (
            <Btn icon={<Volume2 size={14}/>} label="نداء (حالة)" color="#3B82F6" loading={loading === 'call'} onClick={() => act('call')} />
          )}
          {['waiting','called','arrived'].includes(ticket.Status) && (
            <Btn icon={<Play size={14}/>} label="بدء الخدمة" color="#10B981" loading={loading === 'start'} onClick={() => act('start')} />
          )}
          {ticket.Status === 'in_service' && (
            <Btn icon={<CheckCircle size={14}/>} label="إنهاء الخدمة" color="#D6A84F" loading={loading === 'done'} onClick={() => act('done')} />
          )}
          {['waiting','called','arrived'].includes(ticket.Status) && (
            <Btn icon={<SkipForward size={14}/>} label="تخطي" color="#F97316" loading={loading === 'skip'} onClick={() => act('skip')} />
          )}
          {!['done','cancelled'].includes(ticket.Status) && (
            <Btn icon={<ArrowLeftRight size={14}/>} label="نقل لحلاق" color="#8B5CF6" onClick={() => onTransfer(ticket)} />
          )}
          {!['done','cancelled'].includes(ticket.Status) && (
            <Btn icon={<XCircle size={14}/>} label="إلغاء" color="#EF4444" loading={loading === 'cancel'} onClick={() => act('cancel')} />
          )}
        </div>
      </div>
    </div>
  );
}

function Btn({ icon, label, color, onClick, loading }: {
  icon: React.ReactNode; label: string; color: string; onClick: () => void; loading?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={!!loading}
      className="flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
      style={{ borderColor: color + '44', color, background: color + '11' }}>
      {loading ? <Loader2 size={14} className="animate-spin"/> : icon}
      {label}
    </button>
  );
}
