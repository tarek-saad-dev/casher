'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Filter, RefreshCw, CalendarDays, ChevronDown,
  Phone, User, Clock, CheckCircle2, XCircle, AlertCircle,
  Loader2, ArrowRight, MoreHorizontal, FileText, Ticket,
} from 'lucide-react';

type BookingStatus =
  | 'pending' | 'confirmed' | 'arrived' | 'queued'
  | 'in_service' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled';

interface Booking {
  BookingID: number;
  ClientID: number | null;
  AssignedEmpID: number | null;
  BookingDate: string;
  StartTime: string;
  EndTime: string | null;
  Status: BookingStatus;
  Source: string;
  Notes: string | null;
  QueueTicketID: number | null;
  ConvertedInvID: number | null;
  ClientName: string | null;
  ClientMobile: string | null;
  EmpName: string | null;
  ServiceCount: number;
}

interface Barber { EmpID: number; EmpName: string; }

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending:    { label: 'معلق',       color: '#9CA3AF', bg: 'rgba(156,163,175,0.1)' },
  confirmed:  { label: 'مؤكد',      color: '#3B82F6', bg: 'rgba(59,130,246,0.1)'  },
  arrived:    { label: 'حضر',        color: '#10B981', bg: 'rgba(16,185,129,0.1)'  },
  queued:     { label: 'في الطابور', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)'  },
  in_service: { label: 'في الخدمة', color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)'  },
  completed:  { label: 'مكتمل',     color: '#10B981', bg: 'rgba(16,185,129,0.08)' },
  cancelled:  { label: 'ملغي',      color: '#6B7280', bg: 'rgba(107,114,128,0.08)'},
  no_show:    { label: 'لم يحضر',   color: '#EF4444', bg: 'rgba(239,68,68,0.1)'   },
  rescheduled:{ label: 'أُعيد جدولة',color: '#6366F1', bg: 'rgba(99,102,241,0.1)'  },
};

const SOURCE_LABELS: Record<string, string> = {
  walk_in: 'حضور مباشر', phone: 'هاتف', whatsapp: 'واتساب', website: 'موقع', admin: 'إدارة',
};

// ─── Action menu ───────────────────────────────────────────────────────────────
function ActionMenu({
  booking, onAction, onClose,
}: {
  booking: Booking;
  onAction: (id: number, action: string, extra?: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const s = booking.Status;
  const actions: { key: string; label: string; icon: React.ReactNode; color?: string }[] = [];

  if (s === 'pending')    actions.push({ key: 'confirm',    label: 'تأكيد الحجز',        icon: <CheckCircle2 size={13} /> });
  if (['pending','confirmed'].includes(s))
                          actions.push({ key: 'arrive',     label: 'سجل الحضور',          icon: <User size={13} /> });
  if (s === 'arrived')    actions.push({ key: 'queue',      label: 'أضف للطابور',         icon: <Ticket size={13} /> });
  if (['arrived','queued'].includes(s))
                          actions.push({ key: 'start_service', label: 'بدء الخدمة',       icon: <CheckCircle2 size={13} /> });
  if (s === 'in_service') actions.push({ key: 'complete',   label: 'إنهاء الخدمة',        icon: <CheckCircle2 size={13} /> });
  if (['completed','in_service'].includes(s) && !booking.ConvertedInvID)
                          actions.push({ key: 'convert',    label: 'تحويل لفاتورة',       icon: <FileText size={13} />, color: '#D6A84F' });
  if (!['cancelled','completed','no_show'].includes(s)) {
    actions.push({ key: 'reschedule', label: 'إعادة جدولة', icon: <CalendarDays size={13} /> });
    actions.push({ key: 'no_show',   label: 'لم يحضر',      icon: <AlertCircle size={13} />, color: '#EF4444' });
    actions.push({ key: 'cancel',    label: 'إلغاء الحجز',  icon: <XCircle size={13} />, color: '#EF4444' });
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute left-4 mt-1 w-52 rounded-xl border shadow-2xl overflow-hidden"
        style={{ background: '#1E1E26', borderColor: '#2A2A35', top: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {actions.map(act => (
          <button
            key={act.key}
            onClick={() => { onAction(booking.BookingID, act.key); onClose(); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-zinc-700/30 transition-colors text-right"
            style={{ color: act.color ?? '#D1D5DB' }}
          >
            {act.icon}{act.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const router = useRouter();
  const [bookings, setBookings]     = useState<Booking[]>([]);
  const [barbers, setBarbers]       = useState<Barber[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [openMenu, setOpenMenu]     = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const [filters, setFilters] = useState({
    date: today,
    dateFrom: '',
    dateTo: '',
    empId: '',
    status: 'all',
    source: 'all',
    clientSearch: '',
    useDateRange: false,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.useDateRange) {
        if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
        if (filters.dateTo)   params.set('dateTo',   filters.dateTo);
      } else {
        params.set('date', filters.date);
      }
      if (filters.empId)        params.set('empId',        filters.empId);
      if (filters.status !== 'all') params.set('status',   filters.status);
      if (filters.source !== 'all') params.set('source',   filters.source);
      if (filters.clientSearch) params.set('clientSearch', filters.clientSearch);

      const [bkRes, empRes] = await Promise.all([
        fetch(`/api/bookings?${params}`),
        fetch('/api/employees'),
      ]);
      const bkData  = await bkRes.json();
      const empData = await empRes.json();
      setBookings(bkData.bookings || []);
      setBarbers(Array.isArray(empData) ? empData.filter((e: Barber & { isActive?: number }) => e.isActive !== 0) : []);
    } catch {
      setError('فشل تحميل الحجوزات');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAction = async (id: number, action: string, extra: Record<string, unknown> = {}) => {
    if (action === 'convert') {
      router.push(`/bookings/${id}`);
      return;
    }
    if (action === 'reschedule') {
      router.push(`/bookings/${id}`);
      return;
    }
    setActionLoading(id);
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'فشل تنفيذ الإجراء'); return; }
      fetchData();
    } finally {
      setActionLoading(null);
    }
  };

  const statusCounts = bookings.reduce((acc, b) => {
    acc[b.Status] = (acc[b.Status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-lg font-black text-white tracking-tight">الحجوزات</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{bookings.length} حجز</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all" title="تحديث">
            <RefreshCw size={15} />
          </button>
          <button onClick={() => setShowFilters(f => !f)} className="flex items-center gap-1.5 p-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white transition-all">
            <Filter size={15} />
            <span className="text-xs hidden sm:block">فلترة</span>
          </button>
          <button
            onClick={() => router.push('/bookings/calendar')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 transition-all"
          >
            <CalendarDays size={15} /> التقويم
          </button>
          <button
            onClick={() => router.push('/bookings/new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: 'linear-gradient(135deg,#D6A84F,#B8923A)', color: '#000' }}
          >
            <Plus size={15} /> حجز جديد
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 space-y-3 shrink-0">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">نطاق تاريخ</label>
              <div
                onClick={() => setFilters(f => ({ ...f, useDateRange: !f.useDateRange }))}
                className="relative w-9 h-5 rounded-full cursor-pointer transition-colors"
                style={{ background: filters.useDateRange ? '#D6A84F' : '#374151' }}
              >
                <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ right: filters.useDateRange ? 2 : 'auto', left: filters.useDateRange ? 'auto' : 2 }} />
              </div>
            </div>
            {!filters.useDateRange ? (
              <input
                type="date"
                value={filters.date}
                onChange={e => setFilters(f => ({ ...f, date: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
              />
            ) : (
              <>
                <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50" placeholder="من" />
                <input type="date" value={filters.dateTo}   onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}   className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50" placeholder="إلى" />
              </>
            )}

            <select
              value={filters.empId}
              onChange={e => setFilters(f => ({ ...f, empId: e.target.value }))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
            >
              <option value="">كل الحلاقين</option>
              {barbers.map(b => <option key={b.EmpID} value={b.EmpID}>{b.EmpName}</option>)}
            </select>

            <select
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
            >
              <option value="all">كل الحالات</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>

            <select
              value={filters.source}
              onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
            >
              <option value="all">كل المصادر</option>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>

            <div className="relative">
              <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={filters.clientSearch}
                onChange={e => setFilters(f => ({ ...f, clientSearch: e.target.value }))}
                placeholder="بحث عميل..."
                className="bg-zinc-800 border border-zinc-700 rounded-lg pr-7 pl-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50 w-40"
              />
            </div>
          </div>
        </div>
      )}

      {/* Status summary chips */}
      {Object.keys(statusCounts).length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 py-2.5 border-b border-zinc-800 shrink-0">
          {Object.entries(statusCounts).map(([st, cnt]) => {
            const cfg = STATUS_CONFIG[st as BookingStatus];
            if (!cfg) return null;
            return (
              <span key={st} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33` }}>
                {cfg.label}: {cnt}
              </span>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto scrollbar-luxury-v">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="animate-spin text-amber-400" size={28} />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-center">
              <AlertCircle className="text-red-400 mx-auto mb-2" size={28} />
              <p className="text-red-400 text-sm">{error}</p>
              <button onClick={fetchData} className="mt-2 text-xs text-zinc-400 underline">إعادة المحاولة</button>
            </div>
          </div>
        ) : bookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
            <CalendarDays size={32} className="mb-3" />
            <p className="text-sm">لا توجد حجوزات</p>
            <button onClick={() => router.push('/bookings/new')} className="mt-3 text-xs text-amber-400 underline">أضف حجزاً جديداً</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="text-right">
                {['الوقت', 'العميل', 'الحلاق', 'الخدمات', 'المصدر', 'الحالة', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-xs font-semibold text-zinc-500 border-b border-zinc-800 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => {
                const cfg = STATUS_CONFIG[b.Status] ?? STATUS_CONFIG.pending;
                const isLoading = actionLoading === b.BookingID;
                return (
                  <tr
                    key={b.BookingID}
                    className="border-b border-zinc-800/60 hover:bg-zinc-900/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/bookings/${b.BookingID}`)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-white font-semibold">
                        <Clock size={12} className="text-zinc-500" />
                        {String(b.StartTime).slice(0, 5)}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">{new Date(b.BookingDate).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {b.ClientName?.charAt(0) ?? <User size={12} />}
                        </div>
                        <div>
                          <p className="text-white font-medium">{b.ClientName || <span className="text-zinc-500">غير محدد</span>}</p>
                          {b.ClientMobile && (
                            <p className="text-[11px] text-zinc-500 flex items-center gap-1"><Phone size={9} />{b.ClientMobile}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{b.EmpName || <span className="text-zinc-600">—</span>}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{b.ServiceCount || 0} خدمة</td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-zinc-500">{SOURCE_LABELS[b.Source] ?? b.Source}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33` }}>
                        {cfg.label}
                      </span>
                      {b.ConvertedInvID && (
                        <span className="mr-1 text-xs text-amber-400">· فاتورة</span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === b.BookingID ? null : b.BookingID); }}
                          disabled={isLoading}
                          className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-500 hover:text-white transition-all disabled:opacity-40"
                        >
                          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
                        </button>
                        {openMenu === b.BookingID && (
                          <ActionMenu
                            booking={b}
                            onAction={handleAction}
                            onClose={() => setOpenMenu(null)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
