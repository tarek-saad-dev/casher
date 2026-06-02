'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Search, RefreshCw, CalendarDays,
  Phone, User, Clock, AlertCircle,
  Loader2, Pencil, Trash2, X, CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import CreateBookingModal from '@/components/bookings/CreateBookingModal';

type BookingStatus =
  | 'pending' | 'confirmed' | 'arrived' | 'queued'
  | 'in_service' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled';

interface Booking {
  BookingID:      number;
  BookingCode:    string | null;
  ClientID:       number | null;
  AssignedEmpID:  number | null;
  BookingDate:    string;
  StartTime:      string;
  EndTime:        string | null;
  Status:         BookingStatus;
  Source:         string;
  Notes:          string | null;
  QueueTicketID:  number | null;
  ConvertedInvID: number | null;
  ClientName:     string | null;
  ClientMobile:   string | null;
  EmpName:        string | null;
  ServiceCount:   number;
  ServiceNames:   string | null;
  TotalPrice:     number | null;
  TotalDuration:  number | null;
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: 'معلق',          color: '#9CA3AF', bg: 'rgba(156,163,175,0.12)' },
  confirmed:   { label: 'مؤكد',          color: '#3B82F6', bg: 'rgba(59,130,246,0.12)'  },
  arrived:     { label: 'وصل',           color: '#10B981', bg: 'rgba(16,185,129,0.12)'  },
  queued:      { label: 'وصل',           color: '#10B981', bg: 'rgba(16,185,129,0.12)'  },
  in_service:  { label: 'قيد الخدمة',   color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)'  },
  completed:   { label: 'مكتمل',         color: '#22C55E', bg: 'rgba(34,197,94,0.10)'   },
  cancelled:   { label: 'ملغي',          color: '#6B7280', bg: 'rgba(107,114,128,0.10)' },
  no_show:     { label: 'لم يحضر',       color: '#EF4444', bg: 'rgba(239,68,68,0.10)'   },
  rescheduled: { label: 'أُعيد جدولة',  color: '#6366F1', bg: 'rgba(99,102,241,0.10)'  },
};

// ─── Day label helpers ────────────────────────────────────────────────────────
function getDayLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  if (dateStr === todayStr)     return 'اليوم';
  if (dateStr === tomorrowStr)  return 'غدًا';

  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTime(value: unknown): string {
  if (!value) return '—';
  const s = String(value);
  // Handle ISO string from SQL time column (1970-01-01T...)
  if (s.includes('T')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
    }
  }
  return s.slice(0, 5);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
interface Toast { id: number; type: 'success' | 'error'; message: string }

// ─── Helper: Check if booking is cancelled ─────────────────────────────────────
function isCancelledBooking(status: string): boolean {
  return status === 'cancelled' || status === 'canceled' || status === 'cancel' || status === 'ملغي';
}

// ─── Confirm dialog for cancel ────────────────────────────────────────────────
function ConfirmDialog({
  bookingId, onConfirm, onCancel, loading,
}: { bookingId: number; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" dir="rtl">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">إلغاء الحجز</p>
            <p className="text-zinc-500 text-xs">حجز رقم #{bookingId}</p>
          </div>
        </div>
        <p className="text-zinc-300 text-sm mb-5">هل أنت متأكد من حذف / إلغاء هذا الحجز؟</p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            تأكيد الإلغاء
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors disabled:opacity-60"
          >
            رجوع
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirm dialog for restore ─────────────────────────────────────────────────
function RestoreConfirmDialog({
  bookingId, onConfirm, onCancel, loading,
}: { bookingId: number; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" dir="rtl">
      <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 w-80 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
            <RotateCcw size={18} className="text-amber-400" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">إرجاع الحجز؟</p>
            <p className="text-zinc-500 text-xs">حجز رقم #{bookingId}</p>
          </div>
        </div>
        <p className="text-zinc-300 text-sm mb-5">سيتم إعادة تفعيل هذا الحجز وإرجاعه إلى الحجوزات المؤكدة.</p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            تأكيد الإرجاع
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-xl border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors disabled:opacity-60"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonGroup() {
  return (
    <div className="mb-6">
      <div className="h-5 w-40 bg-zinc-800 rounded-lg mb-3 animate-pulse" />
      {[1, 2].map(i => (
        <div key={i} className="border border-zinc-800 rounded-xl p-4 mb-2 animate-pulse">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 bg-zinc-800 rounded" />
              <div className="h-3 w-1/2 bg-zinc-800 rounded" />
            </div>
            <div className="h-6 w-14 bg-zinc-800 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Booking card ─────────────────────────────────────────────────────────────
function BookingCard({
  booking, onCancelClick, onRestoreClick, cancelLoading, restoreLoading,
}: {
  booking: Booking;
  onCancelClick: (b: Booking) => void;
  onRestoreClick: (b: Booking) => void;
  cancelLoading: boolean;
  restoreLoading: boolean;
}) {
  const cfg = STATUS_CONFIG[booking.Status] ?? STATUS_CONFIG.pending;
  const isClosed = ['cancelled','completed','no_show'].includes(booking.Status);
  const isCancelled = isCancelledBooking(booking.Status);

  return (
    <div
      className="border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
      style={{ background: '#18181f' }}
    >
      <div className="flex items-start gap-3">
        {/* Time column */}
        <div className="shrink-0 text-center w-12">
          <p className="text-white font-bold text-base leading-tight">{formatTime(booking.StartTime)}</p>
          {booking.EndTime && (
            <p className="text-zinc-600 text-[10px] mt-0.5">{formatTime(booking.EndTime)}</p>
          )}
        </div>

        {/* Separator */}
        <div className="shrink-0 mt-1 flex flex-col items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
          <div className="w-px flex-1 bg-zinc-800 min-h-[28px]" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <p className="text-white font-semibold text-sm leading-tight">
                {booking.ClientName || <span className="text-zinc-500">عميل غير محدد</span>}
              </p>
              {booking.ClientMobile && (
                <p className="text-zinc-500 text-xs flex items-center gap-1 mt-0.5">
                  <Phone size={9} />{booking.ClientMobile}
                </p>
              )}
            </div>
            <span
              className="text-xs px-2.5 py-0.5 rounded-full font-medium shrink-0"
              style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}30` }}
            >
              {cfg.label}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-400">
            {booking.EmpName && (
              <span className="flex items-center gap-1">
                <User size={10} className="text-zinc-600" />مع {booking.EmpName}
              </span>
            )}
            {booking.ServiceNames ? (
              <span className="flex items-center gap-1 truncate max-w-[200px]">
                <Clock size={10} className="text-zinc-600 shrink-0" />{booking.ServiceNames}
              </span>
            ) : booking.ServiceCount > 0 ? (
              <span className="flex items-center gap-1">
                <Clock size={10} className="text-zinc-600" />{booking.ServiceCount} خدمة
              </span>
            ) : null}
            {booking.TotalPrice != null && booking.TotalPrice > 0 && (
              <span className="text-amber-400/80">{booking.TotalPrice} ج.م</span>
            )}
            {booking.BookingCode && (
              <span className="text-zinc-600 font-mono">{booking.BookingCode}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title="تعديل الحجز سيتم تفعيله قريبًا"
            disabled
            className="p-1.5 rounded-lg text-zinc-600 cursor-not-allowed opacity-40"
          >
            <Pencil size={14} />
          </button>
          
          {/* Restore button - only for cancelled bookings */}
          {isCancelled && (
            <button
              type="button"
              onClick={() => onRestoreClick(booking)}
              disabled={restoreLoading}
              title="إرجاع الحجز إلى الحجوزات المؤكدة"
              className="p-1.5 rounded-lg text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/30 transition-colors disabled:opacity-40"
            >
              {restoreLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            </button>
          )}
          
          {/* Cancel button - not shown for closed bookings (unless cancelled which has restore instead) */}
          {!isClosed && (
            <button
              type="button"
              onClick={() => onCancelClick(booking)}
              disabled={cancelLoading}
              title="إلغاء الحجز"
              className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
            >
              {cancelLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function BookingsPage() {
  const [bookings, setBookings]       = useState<Booking[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [search, setSearch]           = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [toasts, setToasts]     = useState<Toast[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<Booking | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Booking | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const toastIdRef = useRef(0);

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastIdRef.current;
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // Compute 7-day range once
  const { dateFrom, dateTo } = useMemo(() => {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const end = new Date(today); end.setDate(today.getDate() + 6);
    const to = end.toISOString().slice(0, 10);
    return { dateFrom: from, dateTo: to };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      const res = await fetch(`/api/bookings?${params}`);
      if (!res.ok) throw new Error('فشل الاتصال');
      const data = await res.json();
      setBookings(data.bookings || []);
    } catch {
      setError('فشل تحميل الحجوزات. تحقق من الاتصال وحاول مجدداً.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter by search query
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter(b =>
      (b.ClientName   ?? '').toLowerCase().includes(q) ||
      (b.ClientMobile ?? '').toLowerCase().includes(q) ||
      (b.BookingCode  ?? '').toLowerCase().includes(q) ||
      (b.EmpName      ?? '').toLowerCase().includes(q) ||
      (b.ServiceNames ?? '').toLowerCase().includes(q)
    );
  }, [bookings, search]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Booking[]>();
    // Pre-populate all 7 days in order
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      map.set(d.toISOString().slice(0, 10), []);
    }
    for (const b of filtered) {
      const key = String(b.BookingDate).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Soft cancel
  const handleCancel = async () => {
    if (!confirmTarget) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/bookings/${confirmTarget.BookingID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast('error', data.error || 'فشل إلغاء الحجز');
        return;
      }
      addToast('success', 'تم إلغاء الحجز بنجاح');
      setConfirmTarget(null);
      fetchData();
    } catch {
      addToast('error', 'فشل الاتصال بالخادم');
    } finally {
      setCancelLoading(false);
    }
  };

  // Restore booking
  const handleRestore = async () => {
    if (!restoreTarget) return;
    setRestoreLoading(true);
    try {
      const res = await fetch(`/api/bookings/${restoreTarget.BookingID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast('error', data.error || 'فشل إرجاع الحجز');
        return;
      }
      addToast('success', 'تم إرجاع الحجز بنجاح');
      setRestoreTarget(null);
      fetchData();
    } catch {
      addToast('error', 'فشل الاتصال بالخادم');
    } finally {
      setRestoreLoading(false);
    }
  };

  const totalFiltered = filtered.length;

  return (
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-lg font-black text-white tracking-tight">إدارة الحجوزات</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            حجوزات الـ 7 أيام القادمة
            {!loading && ` · ${totalFiltered} حجز`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all disabled:opacity-50"
            title="تحديث"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
          >
            <Plus size={15} /> حجز جديد
          </button>
        </div>
      </div>

      {/* ── Search ──────────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-zinc-800 shrink-0">
        <div className="relative">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث باسم العميل، رقم الهاتف، كود الحجز، الحلاق، الخدمة..."
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pr-9 pl-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 scrollbar-luxury-v">

        {loading ? (
          <>{[1,2,3].map(i => <SkeletonGroup key={i} />)}</>

        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={fetchData}
              className="px-4 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>

        ) : totalFiltered === 0 && search ? (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
            <Search size={28} className="text-zinc-600" />
            <p className="text-zinc-500 text-sm">لا توجد نتائج لـ &quot;{search}&quot;</p>
            <button onClick={() => setSearch('')} className="text-xs text-amber-400 underline">مسح البحث</button>
          </div>

        ) : (
          grouped.map(([dateKey, items]) => (
            <div key={dateKey}>
              {/* Day header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <CalendarDays size={14} className="text-amber-400/70" />
                  <span className="text-sm font-bold text-white">{getDayLabel(dateKey)}</span>
                  <span className="text-xs text-zinc-600">
                    {new Date(dateKey + 'T00:00:00').toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' })}
                  </span>
                </div>
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-xs text-zinc-600">{items.length} حجز</span>
              </div>

              {/* Bookings or empty */}
              {items.length === 0 ? (
                <div className="border border-zinc-800/50 border-dashed rounded-xl py-4 px-4 text-center">
                  <p className="text-xs text-zinc-700">لا توجد حجوزات في هذا اليوم</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map(b => (
                    <BookingCard
                      key={b.BookingID}
                      booking={b}
                      onCancelClick={setConfirmTarget}
                      onRestoreClick={setRestoreTarget}
                      cancelLoading={cancelLoading && confirmTarget?.BookingID === b.BookingID}
                      restoreLoading={restoreLoading && restoreTarget?.BookingID === b.BookingID}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Confirm dialog for cancel ───────────────────────────────── */}
      {confirmTarget && (
        <ConfirmDialog
          bookingId={confirmTarget.BookingID}
          onConfirm={handleCancel}
          onCancel={() => { if (!cancelLoading) setConfirmTarget(null); }}
          loading={cancelLoading}
        />
      )}

      {/* ── Confirm dialog for restore ───────────────────────────────── */}
      {restoreTarget && (
        <RestoreConfirmDialog
          bookingId={restoreTarget.BookingID}
          onConfirm={handleRestore}
          onCancel={() => { if (!restoreLoading) setRestoreTarget(null); }}
          loading={restoreLoading}
        />
      )}

      {/* ── Create booking modal ────────────────────────────────────── */}
      <CreateBookingModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={(code) => {
          setCreateModalOpen(false);
          addToast('success', code ? `تم إنشاء الحجز بنجاح · ${code}` : 'تم إنشاء الحجز بنجاح');
          fetchData();
        }}
      />

      {/* ── Toasts ──────────────────────────────────────────────────── */}
      <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 w-72">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium
              ${t.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/90 border-rose-500/40 text-rose-300'}`}
          >
            {t.type === 'success'
              ? <CheckCircle2 size={15} className="shrink-0" />
              : <AlertCircle size={15} className="shrink-0" />}
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
