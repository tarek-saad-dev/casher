'use client';

import { X, CheckCircle, UserCheck, Plus, Play, ReceiptText, CalendarClock, XCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Booking } from '@/lib/operationsTypes';
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_COLORS } from '@/lib/operationsTypes';

interface Props {
  booking:  Booking;
  onClose:  () => void;
  onAction: (bookingId: number, action: string) => Promise<void>;
}

export function BookingActionModal({ booking, onClose, onAction }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  const act = async (action: string) => {
    setLoading(action);
    try { await onAction(booking.BookingID, action); }
    finally { setLoading(null); }
  };

  const color = BOOKING_STATUS_COLORS[booking.Status] ?? '#6B7280';
  const label = BOOKING_STATUS_LABELS[booking.Status] ?? booking.Status;

  const timeStr = String(booking.StartTime ?? '').slice(0, 5);
  const endStr  = String(booking.EndTime   ?? '').slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="relative rounded-2xl border shadow-2xl w-full max-w-md mx-4"
        style={{ background: '#141418', borderColor: '#2A2A35' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#2A2A35' }}>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-white">{timeStr}{endStr ? ` — ${endStr}` : ''}</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold"
              style={{ background: color + '22', color, border: `1px solid ${color}44` }}>{label}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {[
            ['العميل',  booking.ClientName   ?? '—'],
            ['الهاتف',  booking.ClientMobile ?? '—'],
            ['الحلاق',  booking.EmpName      ?? '—'],
            ['التاريخ', booking.BookingDate  ?? '—'],
            ['المصدر',  booking.Source       ?? '—'],
            ['الخدمات', `${booking.ServiceCount} خدمة`],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between text-sm">
              <span className="text-zinc-500">{l}</span>
              <span className="text-white font-medium">{v}</span>
            </div>
          ))}
          {booking.Notes && (
            <div className="pt-1 text-xs text-zinc-400 bg-zinc-900 rounded-lg px-3 py-2">{booking.Notes}</div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          {booking.Status === 'pending' && (
            <Btn icon={<CheckCircle size={14}/>} label="تأكيد" color="#10B981" loading={loading==='confirm'} onClick={() => act('confirm')} />
          )}
          {['pending','confirmed'].includes(booking.Status) && (
            <Btn icon={<UserCheck size={14}/>} label="وصل" color="#8B5CF6" loading={loading==='arrive'} onClick={() => act('arrive')} />
          )}
          {['arrived','confirmed'].includes(booking.Status) && (
            <Btn icon={<Plus size={14}/>} label="إضافة للدور" color="#F59E0B" loading={loading==='add_queue'} onClick={() => act('add_queue')} />
          )}
          {['arrived','queued'].includes(booking.Status) && (
            <Btn icon={<Play size={14}/>} label="بدء الخدمة" color="#06B6D4" loading={loading==='start'} onClick={() => act('start')} />
          )}
          {booking.Status === 'in_service' && (
            <Btn icon={<ReceiptText size={14}/>} label="تحويل لفاتورة" color="#D6A84F" loading={loading==='invoice'} onClick={() => act('invoice')} />
          )}
          {!['done','cancelled','no_show'].includes(booking.Status) && (
            <Btn icon={<CalendarClock size={14}/>} label="تعديل الموعد" color="#6B7280" loading={loading==='reschedule'} onClick={() => act('reschedule')} />
          )}
          {!['done','cancelled'].includes(booking.Status) && (
            <Btn icon={<XCircle size={14}/>} label="إلغاء" color="#EF4444" loading={loading==='cancel'} onClick={() => act('cancel')} />
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
