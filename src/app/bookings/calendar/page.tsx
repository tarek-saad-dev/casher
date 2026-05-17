'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, ChevronLeft, Plus, RefreshCw, Filter,
  Clock, User, AlertCircle, Loader2, CalendarDays,
} from 'lucide-react';

type BookingStatus =
  | 'pending' | 'confirmed' | 'arrived' | 'queued'
  | 'in_service' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled';

interface Booking {
  BookingID: number;
  ClientName: string | null;
  ClientMobile: string | null;
  EmpName: string | null;
  AssignedEmpID: number | null;
  BookingDate: string;
  StartTime: string;
  EndTime: string | null;
  Status: BookingStatus;
  Source: string;
  ServiceCount: number;
  Notes: string | null;
}

interface Barber { EmpID: number; EmpName: string; }

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bg: string; border: string }> = {
  pending:    { label: 'معلق',        color: '#9CA3AF', bg: '#1F1F2A', border: '#374151' },
  confirmed:  { label: 'مؤكد',       color: '#93C5FD', bg: '#1E2A3A', border: '#1D4ED8' },
  arrived:    { label: 'حضر',         color: '#6EE7B7', bg: '#1A2E28', border: '#065F46' },
  queued:     { label: 'في الطابور',  color: '#FCD34D', bg: '#2A2211', border: '#D97706' },
  in_service: { label: 'في الخدمة',  color: '#C4B5FD', bg: '#211A2E', border: '#7C3AED' },
  completed:  { label: 'مكتمل',      color: '#6EE7B7', bg: '#162218', border: '#065F46' },
  cancelled:  { label: 'ملغي',       color: '#6B7280', bg: '#1A1A1E', border: '#374151' },
  no_show:    { label: 'لم يحضر',    color: '#FCA5A5', bg: '#2A1A1A', border: '#991B1B' },
  rescheduled:{ label: 'أُعيد جدولة', color: '#A5B4FC', bg: '#1E1E32', border: '#4338CA' },
};

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7am – 8pm

function formatTime(t: string) { return String(t).slice(0, 5); }

function timeToPercent(time: string): number {
  const [h, m] = String(time).split(':').map(Number);
  return ((h - 7) * 60 + m) / (14 * 60) * 100;
}

function durationToPercent(start: string, end: string | null): number {
  if (!end) return (30 / (14 * 60)) * 100;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(end).split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max((30 / (14 * 60)) * 100, (mins / (14 * 60)) * 100);
}

// ─── Booking block ────────────────────────────────────────────────────────────
function BookingBlock({ booking, onClick }: { booking: Booking; onClick: () => void }) {
  const cfg = STATUS_CONFIG[booking.Status] ?? STATUS_CONFIG.pending;
  const top = timeToPercent(booking.StartTime);
  const height = durationToPercent(booking.StartTime, booking.EndTime);

  return (
    <button
      onClick={onClick}
      className="absolute inset-x-1 rounded-lg border text-right overflow-hidden transition-all hover:z-20 hover:scale-[1.02]"
      style={{
        top: `${top}%`,
        height: `${Math.max(height, 4)}%`,
        minHeight: 36,
        background: cfg.bg,
        borderColor: cfg.border,
        zIndex: 10,
      }}
    >
      <div className="px-2 py-1.5 h-full flex flex-col justify-between overflow-hidden">
        <div>
          <p className="text-[11px] font-bold truncate" style={{ color: cfg.color }}>
            {formatTime(booking.StartTime)}
          </p>
          <p className="text-[11px] text-white font-medium truncate leading-tight">
            {booking.ClientName || 'عميل غير محدد'}
          </p>
        </div>
        <span className="text-[10px] truncate" style={{ color: cfg.color }}>{cfg.label}</span>
      </div>
    </button>
  );
}

// ─── Day column ───────────────────────────────────────────────────────────────
function DayColumn({
  date, barber, bookings, onBookingClick, onNewBooking,
}: {
  date: string; barber: Barber | null;
  bookings: Booking[]; onBookingClick: (b: Booking) => void;
  onNewBooking: (date: string, time: string, empId: number | null) => void;
}) {
  const GRID_HEIGHT = 840; // px — 14h * 60px/h

  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pct = y / rect.height;
    const totalMins = pct * 14 * 60;
    const hour = Math.floor(totalMins / 60) + 7;
    const min  = Math.round((totalMins % 60) / 15) * 15;
    const time = `${String(hour).padStart(2,'0')}:${String(Math.min(min,59)).padStart(2,'0')}`;
    onNewBooking(date, time, barber?.EmpID ?? null);
  };

  return (
    <div className="relative flex-1 min-w-[160px]" style={{ height: GRID_HEIGHT }}>
      {/* Hour grid lines */}
      {HOURS.map(h => (
        <div key={h} className="absolute w-full border-t border-zinc-800/60" style={{ top: `${((h - 7) / 14) * 100}%` }} />
      ))}
      {/* Half-hour lines */}
      {HOURS.map(h => (
        <div key={`${h}h`} className="absolute w-full border-t border-zinc-800/20" style={{ top: `${((h - 7 + 0.5) / 14) * 100}%` }} />
      ))}

      {/* Click area */}
      <div className="absolute inset-0 cursor-pointer" onClick={handleGridClick} />

      {/* Bookings */}
      {bookings.map(b => (
        <BookingBlock key={b.BookingID} booking={b} onClick={() => onBookingClick(b)} />
      ))}
    </div>
  );
}

// ─── Booking drawer ───────────────────────────────────────────────────────────
function BookingDrawer({ booking, onClose, onNavigate }: {
  booking: Booking; onClose: () => void; onNavigate: (id: number) => void;
}) {
  const cfg = STATUS_CONFIG[booking.Status] ?? STATUS_CONFIG.pending;
  return (
    <div className="fixed inset-0 z-50 flex justify-start" onClick={onClose}>
      <div
        className="h-full w-80 border-l shadow-2xl p-5 overflow-y-auto scrollbar-luxury-v"
        style={{ background: '#141418', borderColor: '#2A2A35', marginRight: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
            {cfg.label}
          </span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white text-xs">✕</button>
        </div>

        <h3 className="text-base font-black text-white mb-4">حجز #{booking.BookingID}</h3>

        <div className="space-y-3 text-sm">
          <Row icon={<User size={13}/>} label="العميل" value={booking.ClientName || '—'} />
          <Row icon={<Clock size={13}/>} label="الوقت" value={`${formatTime(booking.StartTime)}${booking.EndTime ? ' — ' + formatTime(booking.EndTime) : ''}`} />
          <Row icon={<User size={13}/>} label="الحلاق" value={booking.EmpName || '—'} />
          <Row icon={<CalendarDays size={13}/>} label="الخدمات" value={`${booking.ServiceCount} خدمة`} />
        </div>

        {booking.Notes && (
          <div className="mt-4 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
            <p className="text-xs text-zinc-500 mb-1">ملاحظات</p>
            <p className="text-xs text-zinc-300">{booking.Notes}</p>
          </div>
        )}

        <button
          onClick={() => onNavigate(booking.BookingID)}
          className="mt-5 w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
        >فتح الحجز</button>
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-zinc-300">
      <span className="text-zinc-500 shrink-0">{icon}</span>
      <span className="text-zinc-500 text-xs">{label}:</span>
      <span className="text-xs text-white font-medium">{value}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BookingsCalendarPage() {
  const router = useRouter();
  const [bookings, setBookings]   = useState<Booking[]>([]);
  const [barbers,  setBarbers]    = useState<Barber[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);
  const [viewDate, setViewDate]   = useState(new Date().toISOString().slice(0, 10));
  const [filterEmpId, setFilterEmpId] = useState<string>('all');
  const [drawerBooking, setDrawerBooking] = useState<Booking | null>(null);
  const [viewMode, setViewMode]   = useState<'day' | 'week'>('day');

  const GRID_HEIGHT = 840;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = '';
      if (viewMode === 'day') {
        url = `/api/bookings?date=${viewDate}`;
      } else {
        // Week: Mon–Sun
        const d = new Date(viewDate);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(d.setDate(diff));
        const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
        url = `/api/bookings?dateFrom=${mon.toISOString().slice(0,10)}&dateTo=${sun.toISOString().slice(0,10)}`;
      }
      const [bkRes, empRes] = await Promise.all([
        fetch(url), fetch('/api/employees'),
      ]);
      const bkData  = await bkRes.json();
      const empData = await empRes.json();
      setBookings(bkData.bookings || []);
      setBarbers(Array.isArray(empData) ? empData.filter((e: Barber & { isActive?: number }) => e.isActive !== 0) : []);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [viewDate, viewMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const navigate = (dir: 1 | -1) => {
    const d = new Date(viewDate);
    d.setDate(d.getDate() + (viewMode === 'day' ? dir : dir * 7));
    setViewDate(d.toISOString().slice(0, 10));
  };

  const displayBarbers = filterEmpId === 'all'
    ? barbers
    : barbers.filter(b => b.EmpID === parseInt(filterEmpId));

  const filteredBookings = filterEmpId === 'all'
    ? bookings
    : bookings.filter(b => b.AssignedEmpID === parseInt(filterEmpId));

  const dateLabel = new Date(viewDate).toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const handleNewBooking = (date: string, time: string, empId: number | null) => {
    router.push(`/bookings/new?date=${date}&time=${time}${empId ? `&empId=${empId}` : ''}`);
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-lg font-black text-white tracking-tight">تقويم الحجوزات</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white transition-all">
            <RefreshCw size={15} />
          </button>
          {/* View toggle */}
          <div className="flex rounded-xl border border-zinc-700 overflow-hidden">
            {(['day','week'] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className="px-3 py-1.5 text-xs font-semibold transition-all"
                style={viewMode === m ? { background: 'rgba(214,168,79,0.15)', color: '#D6A84F' } : { background: 'transparent', color: '#6B7280' }}>
                {m === 'day' ? 'يوم' : 'أسبوع'}
              </button>
            ))}
          </div>
          {/* Barber filter */}
          <select
            value={filterEmpId}
            onChange={e => setFilterEmpId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
          >
            <option value="all">كل الحلاقين</option>
            {barbers.map(b => <option key={b.EmpID} value={b.EmpID}>{b.EmpName}</option>)}
          </select>
          <button
            onClick={() => router.push('/bookings/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
          >
            <Plus size={15} /> حجز جديد
          </button>
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-zinc-800 shrink-0">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all">
          <ChevronRight size={16} />
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewDate(new Date().toISOString().slice(0, 10))}
            className="text-xs px-3 py-1 rounded-full border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all"
          >اليوم</button>
          <input
            type="date"
            value={viewDate}
            onChange={e => setViewDate(e.target.value)}
            className="bg-transparent border border-zinc-700 rounded-lg px-3 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all">
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-amber-400" size={28} />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="text-red-400 mx-auto mb-2" size={28} />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto scrollbar-luxury">
          <div className="flex" style={{ minWidth: 'max-content' }}>
            {/* Time axis */}
            <div className="shrink-0 w-14 pt-12 border-l border-zinc-800" style={{ height: GRID_HEIGHT + 48 }}>
              {HOURS.map(h => (
                <div key={h} className="text-[10px] text-zinc-600 text-center" style={{ height: 60 }}>
                  {String(h).padStart(2,'0')}:00
                </div>
              ))}
            </div>

            {/* Columns */}
            <div className="flex flex-1 gap-0 divide-x divide-zinc-800/50">
              {displayBarbers.map(barber => {
                const barkBookings = filteredBookings.filter(b =>
                  b.AssignedEmpID === barber.EmpID &&
                  (viewMode === 'day' ? b.BookingDate.slice(0,10) === viewDate : true)
                );
                return (
                  <div key={barber.EmpID} className="flex-1 min-w-[180px]">
                    {/* Barber header */}
                    <div className="h-12 flex items-center justify-center gap-2 border-b border-zinc-800 px-3 sticky top-0 bg-zinc-950 z-10">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}>
                        {barber.EmpName.charAt(0)}
                      </div>
                      <span className="text-xs font-semibold text-white truncate">{barber.EmpName}</span>
                      <span className="text-[10px] text-zinc-500">({barkBookings.length})</span>
                    </div>
                    {/* Day grid */}
                    <DayColumn
                      date={viewDate}
                      barber={barber}
                      bookings={barkBookings}
                      onBookingClick={setDrawerBooking}
                      onNewBooking={handleNewBooking}
                    />
                  </div>
                );
              })}

              {/* Unassigned */}
              {(() => {
                const unassigned = filteredBookings.filter(b =>
                  !b.AssignedEmpID &&
                  (viewMode === 'day' ? b.BookingDate.slice(0,10) === viewDate : true)
                );
                if (!unassigned.length) return null;
                return (
                  <div key="unassigned" className="flex-1 min-w-[180px]">
                    <div className="h-12 flex items-center justify-center gap-2 border-b border-zinc-800 px-3 sticky top-0 bg-zinc-950 z-10">
                      <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs">—</div>
                      <span className="text-xs font-semibold text-zinc-500">غير محدد</span>
                      <span className="text-[10px] text-zinc-600">({unassigned.length})</span>
                    </div>
                    <DayColumn
                      date={viewDate}
                      barber={null}
                      bookings={unassigned}
                      onBookingClick={setDrawerBooking}
                      onNewBooking={handleNewBooking}
                    />
                  </div>
                );
              })()}

              {displayBarbers.length === 0 && (
                <div className="flex-1 flex items-center justify-center h-48 text-zinc-600 text-sm">
                  لا يوجد حلاقون
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status legend */}
      <div className="px-6 py-2.5 border-t border-zinc-800 flex flex-wrap gap-3 shrink-0">
        {Object.entries(STATUS_CONFIG).filter(([k]) => !['cancelled','no_show','rescheduled'].includes(k)).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: v.color }} />
            <span className="text-zinc-500">{v.label}</span>
          </span>
        ))}
      </div>

      {/* Drawer */}
      {drawerBooking && (
        <BookingDrawer
          booking={drawerBooking}
          onClose={() => setDrawerBooking(null)}
          onNavigate={(id) => { setDrawerBooking(null); router.push(`/bookings/${id}`); }}
        />
      )}
    </div>
  );
}
