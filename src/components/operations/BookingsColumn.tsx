'use client';

import { useState } from 'react';
import { CalendarCheck, AlertTriangle, User, Clock, Plus, CheckCircle, UserCheck, Play, ReceiptText, XCircle } from 'lucide-react';
import type { Booking, BookingStatus } from '@/lib/operationsTypes';
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_COLORS } from '@/lib/operationsTypes';
import { BookingDetailsModal } from './BookingDetailsModal';

type Tab = 'today' | 'upcoming' | 'late' | 'arrived' | 'cancelled';

const TABS: { key: Tab; label: string }[] = [
  { key: 'today',     label: 'اليوم'    },
  { key: 'upcoming',  label: 'القادمة'  },
  { key: 'late',      label: 'متأخرة'   },
  { key: 'arrived',   label: 'وصلوا'   },
  { key: 'cancelled', label: 'ملغية'    },
];

interface Props {
  bookings:  Booking[];
  loading:   boolean;
  onAction:  (bookingId: number, action: string) => Promise<void>;
  onRefresh: () => void;
}

export function BookingsColumn({ bookings, loading, onAction, onRefresh }: Props) {
  const [tab,      setTab]      = useState<Tab>('today');
  const [selected, setSelected] = useState<Booking | null>(null);

  const now     = new Date();
  const nowTime = now.toTimeString().slice(0, 5);

  const filterBookings = (t: Tab): Booking[] => {
    switch (t) {
      case 'today':
        return bookings.filter(b => !['cancelled','no_show'].includes(b.Status));
      case 'upcoming':
        return bookings.filter(b =>
          ['pending','confirmed'].includes(b.Status) &&
          String(b.StartTime ?? '').slice(0,5) >= nowTime
        );
      case 'late':
        return bookings.filter(b => {
          const t = String(b.StartTime ?? '').slice(0,5);
          return ['pending','confirmed'].includes(b.Status) && t < nowTime;
        });
      case 'arrived':
        return bookings.filter(b => ['arrived','queued'].includes(b.Status));
      case 'cancelled':
        return bookings.filter(b => ['cancelled','no_show'].includes(b.Status));
    }
  };

  const filtered = filterBookings(tab);

  const isLate = (b: Booking) => {
    const t = String(b.StartTime ?? '').slice(0,5);
    return ['pending','confirmed'].includes(b.Status) && t < nowTime;
  };

  const isSoon = (b: Booking) => {
    const t = String(b.StartTime ?? '').slice(0,5);
    if (!t || !['pending','confirmed'].includes(b.Status)) return false;
    const [bh, bm] = t.split(':').map(Number);
    const diff = (bh * 60 + bm) - (now.getHours() * 60 + now.getMinutes());
    return diff > 0 && diff <= 15;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
        <CalendarCheck size={14} className="text-indigo-400"/>
        <span className="text-sm font-bold text-white">الحجوزات</span>
        <span className="mr-auto text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ background: 'rgba(99,102,241,0.15)', color: '#818CF8' }}>
          {bookings.filter(b => ['pending','confirmed'].includes(b.Status)).length} حجز
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto flex-shrink-0" style={{ borderColor: '#2A2A35' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
            style={{
              background: tab === t.key ? 'rgba(99,102,241,0.15)' : 'transparent',
              color:      tab === t.key ? '#818CF8'                : '#6B7280',
              border:     `1px solid ${tab === t.key ? 'rgba(99,102,241,0.3)' : 'transparent'}`,
            }}>
            {t.label} <span className="ml-0.5 opacity-70">({filterBookings(t.key).length})</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">جاري التحميل...</div>}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
            <CalendarCheck size={24} className="mb-2 opacity-30"/>
            <p className="text-sm">لا توجد حجوزات</p>
          </div>
        )}
        {filtered.map(b => {
          const color = BOOKING_STATUS_COLORS[b.Status] ?? '#6B7280';
          const label = BOOKING_STATUS_LABELS[b.Status] ?? b.Status;
          const late  = isLate(b);
          const soon  = isSoon(b);
          const timeStr = String(b.StartTime ?? '').slice(0,5);

          return (
            <div key={b.BookingID}
              onClick={() => setSelected(b)}
              className="rounded-xl border p-3 space-y-2 cursor-pointer transition-all hover:border-zinc-600"
              style={{
                borderColor: late ? 'rgba(239,68,68,0.35)' : soon ? 'rgba(245,158,11,0.35)' : '#2A2A35',
                background: '#1A1A20',
              }}>

              {/* Row 1: time + badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={12} style={{ color: late ? '#EF4444' : soon ? '#F59E0B' : '#6B7280' }}/>
                  <span className="text-base font-bold" style={{ color: late ? '#EF4444' : '#F7F1E5' }}>{timeStr}</span>
                  {(late || soon) && (
                    <AlertTriangle size={12} style={{ color: late ? '#EF4444' : '#F59E0B' }}/>
                  )}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
                  {label}
                </span>
              </div>

              {/* Row 2: client + barber */}
              <div className="flex items-center gap-3 text-xs text-zinc-400">
                {b.ClientName && <span className="flex items-center gap-1"><User size={10}/>{b.ClientName}</span>}
                {b.EmpName    && <span className="flex items-center gap-1"><span style={{ color: '#D6A84F' }}>✂</span>{b.EmpName}</span>}
                <span className="mr-auto text-zinc-600">{b.ServiceCount} خدمة</span>
              </div>

              {/* Row 3: quick actions */}
              <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                {b.Status === 'pending' && (
                  <QuickBtn icon={<CheckCircle size={11}/>} color="#10B981" label="تأكيد" onClick={async () => { await onAction(b.BookingID,'confirm'); onRefresh(); }}/>
                )}
                {['pending','confirmed'].includes(b.Status) && (
                  <QuickBtn icon={<UserCheck size={11}/>} color="#8B5CF6" label="وصل" onClick={async () => { await onAction(b.BookingID,'arrive'); onRefresh(); }}/>
                )}
                {['arrived','confirmed'].includes(b.Status) && (
                  <QuickBtn icon={<Plus size={11}/>} color="#F59E0B" label="للدور" onClick={async () => { await onAction(b.BookingID,'add_queue'); onRefresh(); }}/>
                )}
                {['arrived','queued'].includes(b.Status) && (
                  <QuickBtn icon={<Play size={11}/>} color="#06B6D4" label="بدء" onClick={async () => { await onAction(b.BookingID,'start'); onRefresh(); }}/>
                )}
                {b.Status === 'in_service' && (
                  <QuickBtn icon={<ReceiptText size={11}/>} color="#D6A84F" label="فاتورة" onClick={async () => { await onAction(b.BookingID,'invoice'); onRefresh(); }}/>
                )}
                {!['done','cancelled','no_show'].includes(b.Status) && (
                  <QuickBtn icon={<XCircle size={11}/>} color="#EF4444" label="إلغاء" onClick={async () => { await onAction(b.BookingID,'cancel'); onRefresh(); }}/>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <BookingDetailsModal
          booking={selected}
          onClose={() => { setSelected(null); onRefresh(); }}
          onAction={async (id, action) => { await onAction(id, action); setSelected(null); onRefresh(); }}
        />
      )}
    </div>
  );
}

function QuickBtn({ icon, color, label, onClick }: { icon: React.ReactNode; color: string; label: string; onClick: () => void; }) {
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
