'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
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
  pending: { label: 'معلق', color: 'var(--muted-foreground)', bg: 'var(--muted)', border: 'color-mix(in srgb, var(--muted-foreground) 40%, transparent)' },
  confirmed: { label: 'مؤكد', color: 'var(--info)', bg: 'var(--info-soft)', border: 'color-mix(in srgb, var(--info) 40%, transparent)' },
  arrived: { label: 'حضر', color: 'var(--success)', bg: 'var(--success-soft)', border: 'color-mix(in srgb, var(--success) 40%, transparent)' },
  queued: { label: 'في الطابور', color: 'var(--warning)', bg: 'var(--warning-soft)', border: 'color-mix(in srgb, var(--warning) 40%, transparent)' },
  in_service: { label: 'في الخدمة', color: 'var(--brand)', bg: 'var(--brand-soft)', border: 'color-mix(in srgb, var(--brand) 40%, transparent)' },
  completed: { label: 'مكتمل', color: 'var(--success)', bg: 'var(--success-soft)', border: 'color-mix(in srgb, var(--success) 40%, transparent)' },
  cancelled: { label: 'ملغي', color: 'var(--muted-foreground)', bg: 'var(--muted)', border: 'color-mix(in srgb, var(--muted-foreground) 40%, transparent)' },
  no_show: { label: 'لم يحضر', color: 'var(--destructive)', bg: 'var(--destructive-soft)', border: 'color-mix(in srgb, var(--destructive) 40%, transparent)' },
  rescheduled: { label: 'أُعيد جدولة', color: 'var(--brand)', bg: 'var(--brand-soft)', border: 'color-mix(in srgb, var(--brand) 40%, transparent)' },
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
          <p className="text-[11px] text-foreground font-medium truncate leading-tight">
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
    const min = Math.round((totalMins % 60) / 15) * 15;
    const time = `${String(hour).padStart(2, '0')}:${String(Math.min(min, 59)).padStart(2, '0')}`;
    onNewBooking(date, time, barber?.EmpID ?? null);
  };

  return (
    <div className="relative flex-1 min-w-[160px]" style={{ height: GRID_HEIGHT }}>
      {/* Hour grid lines */}
      {HOURS.map(h => (
        <div key={h} className="absolute w-full border-t border-border" style={{ top: `${((h - 7) / 14) * 100}%` }} />
      ))}
      {/* Half-hour lines */}
      {HOURS.map(h => (
        <div key={`${h}h`} className="absolute w-full border-t border-border" style={{ top: `${((h - 7 + 0.5) / 14) * 100}%` }} />
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
        className="h-full w-[min(20rem,100vw)] border-l shadow-2xl p-5 overflow-y-auto scrollbar-luxury-v"
        style={{ background: 'var(--card)', borderColor: 'var(--border)', marginRight: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
            {cfg.label}
          </span>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-xs">✕</button>
        </div>

        <h3 className="text-base font-black text-foreground mb-4">حجز #{booking.BookingID}</h3>

        <div className="space-y-3 text-sm">
          <Row icon={<User size={13} />} label="العميل" value={booking.ClientName || '—'} />
          <Row icon={<Clock size={13} />} label="الوقت" value={`${formatTime(booking.StartTime)}${booking.EndTime ? ' — ' + formatTime(booking.EndTime) : ''}`} />
          <Row icon={<User size={13} />} label="الحلاق" value={booking.EmpName || '—'} />
          <Row icon={<CalendarDays size={13} />} label="الخدمات" value={`${booking.ServiceCount} خدمة`} />
        </div>

        {booking.Notes && (
          <div className="mt-4 p-3 rounded-xl bg-card border border-border">
            <p className="text-xs text-muted-foreground mb-1">ملاحظات</p>
            <p className="text-xs text-foreground">{booking.Notes}</p>
          </div>
        )}

        <button
          onClick={() => onNavigate(booking.BookingID)}
          className="mt-5 w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        >فتح الحجز</button>
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-foreground">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground text-xs">{label}:</span>
      <span className="text-xs text-foreground font-medium">{value}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BookingsCalendarPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [filterEmpId, setFilterEmpId] = useState<string>('all');
  const [drawerBooking, setDrawerBooking] = useState<Booking | null>(null);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');

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
        url = `/api/bookings?dateFrom=${format(mon, 'yyyy-MM-dd')}&dateTo=${format(sun, 'yyyy-MM-dd')}`;
      }
      const [bkRes, empRes] = await Promise.all([
        fetch(url), fetch('/api/employees'),
      ]);
      const bkData = await bkRes.json();
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
    setViewDate(format(d, 'yyyy-MM-dd'));
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
    <div className="h-full min-h-0 min-w-0 flex flex-col bg-background" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-black text-foreground tracking-tight">تقويم الحجوزات</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 rounded-xl border border-border text-muted-foreground hover:text-foreground transition-all">
            <RefreshCw size={15} />
          </button>
          {/* View toggle */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['day', 'week'] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className="px-3 py-1.5 text-xs font-semibold transition-all"
                style={viewMode === m ? { background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' } : { background: 'transparent', color: 'var(--muted-foreground)' }}>
                {m === 'day' ? 'يوم' : 'أسبوع'}
              </button>
            ))}
          </div>
          {/* Barber filter */}
          <select
            value={filterEmpId}
            onChange={e => setFilterEmpId(e.target.value)}
            className="bg-card border border-border rounded-xl px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">كل الحلاقين</option>
            {barbers.map(b => <option key={b.EmpID} value={b.EmpID}>{b.EmpName}</option>)}
          </select>
          <button
            onClick={() => router.push('/bookings/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            <Plus size={15} /> حجز جديد
          </button>
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-2.5 border-b border-border shrink-0">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
          <ChevronRight size={16} />
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setViewDate(format(new Date(), 'yyyy-MM-dd'))}
            className="text-xs px-3 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-border transition-all"
          >اليوم</button>
          <input
            type="date"
            value={viewDate}
            onChange={e => setViewDate(e.target.value)}
            className="bg-transparent border border-border rounded-lg px-3 py-1 text-xs text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all">
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-warning" size={28} />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="text-destructive mx-auto mb-2" size={28} />
            <p className="text-destructive text-sm">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto scrollbar-luxury">
          <div className="flex" style={{ minWidth: 'max-content' }}>
            {/* Time axis */}
            <div className="shrink-0 w-14 pt-12 border-l border-border" style={{ height: GRID_HEIGHT + 48 }}>
              {HOURS.map(h => (
                <div key={h} className="text-[10px] text-muted-foreground text-center" style={{ height: 60 }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* Columns */}
            <div className="flex flex-1 gap-0 divide-x divide-border">
              {displayBarbers.map(barber => {
                const barkBookings = filteredBookings.filter(b =>
                  b.AssignedEmpID === barber.EmpID &&
                  (viewMode === 'day' ? b.BookingDate.slice(0, 10) === viewDate : true)
                );
                return (
                  <div key={barber.EmpID} className="flex-1 min-w-[180px]">
                    {/* Barber header */}
                    <div className="h-12 flex items-center justify-center gap-2 border-b border-border px-3 sticky top-0 bg-background z-10">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                        {barber.EmpName.charAt(0)}
                      </div>
                      <span className="text-xs font-semibold text-foreground truncate">{barber.EmpName}</span>
                      <span className="text-[10px] text-muted-foreground">({barkBookings.length})</span>
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
                  (viewMode === 'day' ? b.BookingDate.slice(0, 10) === viewDate : true)
                );
                if (!unassigned.length) return null;
                return (
                  <div key="unassigned" className="flex-1 min-w-[180px]">
                    <div className="h-12 flex items-center justify-center gap-2 border-b border-border px-3 sticky top-0 bg-background z-10">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs">—</div>
                      <span className="text-xs font-semibold text-muted-foreground">غير محدد</span>
                      <span className="text-[10px] text-muted-foreground">({unassigned.length})</span>
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
                <div className="flex-1 flex items-center justify-center h-48 text-muted-foreground text-sm">
                  لا يوجد حلاقون
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status legend */}
      <div className="px-6 py-2.5 border-t border-border flex flex-wrap gap-3 shrink-0">
        {Object.entries(STATUS_CONFIG).filter(([k]) => !['cancelled', 'no_show', 'rescheduled'].includes(k)).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: v.color }} />
            <span className="text-muted-foreground">{v.label}</span>
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
