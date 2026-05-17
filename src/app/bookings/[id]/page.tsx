'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, User, Clock, Calendar, Phone, Scissors,
  CheckCircle2, XCircle, Ticket, FileText, RefreshCw,
  AlertCircle, Loader2, Edit2, CalendarDays,
} from 'lucide-react';

type BookingStatus =
  | 'pending' | 'confirmed' | 'arrived' | 'queued'
  | 'in_service' | 'completed' | 'cancelled' | 'no_show' | 'rescheduled';

interface Booking {
  BookingID: number;
  ClientName: string | null;
  ClientMobile: string | null;
  EmpName: string | null;
  BookingDate: string;
  StartTime: string;
  EndTime: string | null;
  Status: BookingStatus;
  Source: string;
  Notes: string | null;
  QueueTicketID: number | null;
  OldInvID: number | null;
  ConvertedInvID: number | null;
  ConvertedInvType: string | null;
  CancelReason: string | null;
  CreatedAt: string;
}

interface BookingService {
  BookingServiceID: number;
  ProName: string | null;
  EmpName: string | null;
  Qty: number;
  Price: number;
  DurationMinutes: number | null;
}

const STATUS_CONFIG: Record<BookingStatus, { label: string; color: string; bg: string }> = {
  pending:    { label: 'معلق',       color: '#9CA3AF', bg: 'rgba(156,163,175,0.12)' },
  confirmed:  { label: 'مؤكد',      color: '#3B82F6', bg: 'rgba(59,130,246,0.12)'  },
  arrived:    { label: 'حضر',        color: '#10B981', bg: 'rgba(16,185,129,0.12)'  },
  queued:     { label: 'في الطابور', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)'  },
  in_service: { label: 'في الخدمة', color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)'  },
  completed:  { label: 'مكتمل',     color: '#10B981', bg: 'rgba(16,185,129,0.08)'  },
  cancelled:  { label: 'ملغي',      color: '#6B7280', bg: 'rgba(107,114,128,0.08)' },
  no_show:    { label: 'لم يحضر',   color: '#EF4444', bg: 'rgba(239,68,68,0.1)'    },
  rescheduled:{ label: 'أُعيد جدولة',color: '#6366F1', bg: 'rgba(99,102,241,0.1)'   },
};

const SOURCE_LABELS: Record<string, string> = {
  walk_in: 'حضور مباشر', phone: 'هاتف', whatsapp: 'واتساب', website: 'موقع', admin: 'إدارة',
};

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [booking, setBooking]    = useState<Booking | null>(null);
  const [services, setServices]  = useState<BookingService[]>([]);
  const [loading, setLoading]    = useState(true);
  const [actLoading, setActLoading] = useState(false);
  const [error, setError]        = useState<string | null>(null);

  // Convert modal
  const [showConvert, setShowConvert] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<{ PaymentMethodID: number; PayMethodName: string }[]>([]);
  const [selectedPM, setSelectedPM] = useState<number | null>(null);
  const [converting, setConverting] = useState(false);

  // Reschedule modal
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');

  // Cancel modal
  const [showCancel, setShowCancel]     = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/bookings/${id}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'فشل تحميل الحجز'); return; }
      setBooking(data.booking);
      setServices(data.services);
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetch('/api/payment-methods').then(r => r.json()).then(d => {
      setPaymentMethods(Array.isArray(d) ? d : d.methods || []);
    });
  }, [id]);

  const doAction = async (action: string, extra: Record<string, unknown> = {}) => {
    setActLoading(true);
    try {
      const res  = await fetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'فشل'); return; }
      fetchData();
    } finally {
      setActLoading(false);
    }
  };

  const doConvert = async () => {
    setConverting(true);
    try {
      const res  = await fetch(`/api/bookings/${id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethodId: selectedPM }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'فشل التحويل'); return; }
      setShowConvert(false);
      fetchData();
    } finally {
      setConverting(false);
    }
  };

  const doAddToQueue = async () => {
    setActLoading(true);
    try {
      // First mark arrived
      if (booking?.Status === 'confirmed' || booking?.Status === 'pending') {
        await fetch(`/api/bookings/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'arrive' }),
        });
      }
      // Create queue ticket
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: parseInt(id) }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'فشل إضافة للطابور'); return; }
      // Mark booking as queued
      await fetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'queue' }),
      });
      fetchData();
      alert(`تم إضافة التذكرة: ${data.ticketCode}`);
    } finally {
      setActLoading(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full bg-zinc-950">
      <Loader2 className="animate-spin text-amber-400" size={32} />
    </div>
  );

  if (error || !booking) return (
    <div className="flex flex-col items-center justify-center h-full bg-zinc-950 text-center px-4">
      <AlertCircle size={32} className="text-red-400 mb-3" />
      <p className="text-red-400 font-semibold mb-2">{error || 'حجز غير موجود'}</p>
      <button onClick={() => router.push('/bookings')} className="text-sm text-amber-400 underline">العودة للحجوزات</button>
    </div>
  );

  const cfg = STATUS_CONFIG[booking.Status] ?? STATUS_CONFIG.pending;
  const totalPrice = services.reduce((s, sv) => s + sv.Price * sv.Qty, 0);
  const totalDuration = services.reduce((s, sv) => s + (sv.DurationMinutes || 30) * sv.Qty, 0);
  const st = booking.Status;
  const isTerminal = ['cancelled', 'no_show', 'completed'].includes(st);

  return (
    <div className="h-full flex flex-col bg-zinc-950" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/bookings')} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all">
            <ArrowRight size={16} />
          </button>
          <div>
            <h1 className="text-base font-black text-white">تفاصيل الحجز #{booking.BookingID}</h1>
            <p className="text-xs text-zinc-500">{new Date(booking.BookingDate).toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white transition-all">
            <RefreshCw size={14} />
          </button>
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}44` }}>
            {cfg.label}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-luxury-v">
        <div className="max-w-2xl mx-auto p-6 space-y-5">

          {/* Actions */}
          {!isTerminal && (
            <div className="rounded-2xl border p-4" style={{ background: '#141418', borderColor: '#2A2A35' }}>
              <p className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wide">الإجراءات</p>
              <div className="flex flex-wrap gap-2">
                {st === 'pending' && (
                  <ActionBtn label="تأكيد الحجز" color="#3B82F6" icon={<CheckCircle2 size={13}/>} onClick={() => doAction('confirm')} loading={actLoading} />
                )}
                {['pending','confirmed'].includes(st) && (
                  <ActionBtn label="سجل الحضور" color="#10B981" icon={<User size={13}/>} onClick={() => doAction('arrive')} loading={actLoading} />
                )}
                {['pending','confirmed','arrived'].includes(st) && (
                  <ActionBtn label="أضف للطابور" color="#F59E0B" icon={<Ticket size={13}/>} onClick={doAddToQueue} loading={actLoading} />
                )}
                {st === 'arrived' && (
                  <ActionBtn label="بدء الخدمة" color="#8B5CF6" icon={<Scissors size={13}/>} onClick={() => doAction('start_service')} loading={actLoading} />
                )}
                {st === 'in_service' && (
                  <ActionBtn label="إنهاء الخدمة" color="#10B981" icon={<CheckCircle2 size={13}/>} onClick={() => doAction('complete')} loading={actLoading} />
                )}
                {['in_service','completed'].includes(st) && !booking.ConvertedInvID && (
                  <ActionBtn label="تحويل لفاتورة" color="#D6A84F" icon={<FileText size={13}/>} onClick={() => setShowConvert(true)} loading={false} />
                )}
                <ActionBtn label="إعادة جدولة" color="#6366F1" icon={<CalendarDays size={13}/>} onClick={() => { setRescheduleDate(booking.BookingDate); setRescheduleTime(String(booking.StartTime).slice(0,5)); setShowReschedule(true); }} loading={false} />
                <ActionBtn label="لم يحضر" color="#EF4444" icon={<AlertCircle size={13}/>} onClick={() => doAction('no_show')} loading={actLoading} />
                <ActionBtn label="إلغاء" color="#EF4444" icon={<XCircle size={13}/>} onClick={() => setShowCancel(true)} loading={false} />
              </div>
            </div>
          )}

          {/* Converted invoice note */}
          {booking.ConvertedInvID && (
            <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/25 flex items-center gap-2 text-sm text-amber-400">
              <FileText size={15} /> تم التحويل لفاتورة رقم #{booking.ConvertedInvID} ({booking.ConvertedInvType})
            </div>
          )}

          {/* Cancel reason */}
          {booking.CancelReason && (
            <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/25 text-sm text-red-400">
              سبب الإلغاء: {booking.CancelReason}
            </div>
          )}

          {/* Info card */}
          <div className="rounded-2xl border p-5 space-y-4" style={{ background: '#141418', borderColor: '#2A2A35' }}>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow icon={<User size={14} className="text-zinc-500"/>} label="العميل" value={booking.ClientName || '—'} />
              <InfoRow icon={<Phone size={14} className="text-zinc-500"/>} label="الجوال" value={booking.ClientMobile || '—'} />
              <InfoRow icon={<Scissors size={14} className="text-zinc-500"/>} label="الحلاق" value={booking.EmpName || 'غير محدد'} />
              <InfoRow icon={<Calendar size={14} className="text-zinc-500"/>} label="التاريخ" value={new Date(booking.BookingDate).toLocaleDateString('ar-EG')} />
              <InfoRow icon={<Clock size={14} className="text-zinc-500"/>} label="الوقت" value={`${String(booking.StartTime).slice(0,5)}${booking.EndTime ? ' — ' + String(booking.EndTime).slice(0,5) : ''}`} />
              <InfoRow icon={<Edit2 size={14} className="text-zinc-500"/>} label="المصدر" value={SOURCE_LABELS[booking.Source] ?? booking.Source} />
            </div>
            {booking.Notes && (
              <div className="pt-2 border-t border-zinc-800">
                <p className="text-xs text-zinc-500 mb-1">ملاحظات</p>
                <p className="text-sm text-zinc-300">{booking.Notes}</p>
              </div>
            )}
          </div>

          {/* Services */}
          <div className="rounded-2xl border p-5" style={{ background: '#141418', borderColor: '#2A2A35' }}>
            <p className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wide">الخدمات</p>
            {services.length === 0 ? (
              <p className="text-zinc-600 text-sm">لا توجد خدمات محددة</p>
            ) : (
              <div className="space-y-2">
                {services.map(svc => (
                  <div key={svc.BookingServiceID} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
                    <Scissors size={14} className="text-zinc-500 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-white font-medium">{svc.ProName || '—'}</p>
                      {svc.EmpName && <p className="text-xs text-zinc-500">{svc.EmpName}</p>}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-amber-400">{(svc.Price * svc.Qty).toFixed(2)} ر.س</p>
                      {svc.DurationMinutes && <p className="text-xs text-zinc-500">{svc.DurationMinutes} د</p>}
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
                  <span className="text-xs text-zinc-500">الإجمالي · {totalDuration} دقيقة</span>
                  <span className="text-base font-black text-amber-400">{totalPrice.toFixed(2)} ر.س</span>
                </div>
              </div>
            )}
          </div>

          {/* Legacy / Queue info */}
          {(booking.OldInvID || booking.QueueTicketID) && (
            <div className="rounded-xl border p-3 text-xs text-zinc-500 space-y-1" style={{ borderColor: '#2A2A35' }}>
              {booking.OldInvID && <p>فاتورة أصلية (قديم): #{booking.OldInvID}</p>}
              {booking.QueueTicketID && <p>تذكرة الطابور: #{booking.QueueTicketID}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Convert modal */}
      {showConvert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border p-6 w-80 shadow-2xl" style={{ background: '#1A1A20', borderColor: '#2A2A35' }}>
            <h3 className="text-base font-bold text-white mb-4">تحويل لفاتورة</h3>
            <p className="text-xs text-zinc-400 mb-3">اختر طريقة الدفع</p>
            <div className="space-y-2 mb-5">
              {paymentMethods.map(pm => (
                <button
                  key={pm.PaymentMethodID}
                  onClick={() => setSelectedPM(pm.PaymentMethodID)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-right transition-all"
                  style={selectedPM === pm.PaymentMethodID
                    ? { borderColor: 'rgba(214,168,79,0.5)', background: 'rgba(214,168,79,0.1)', color: '#D6A84F' }
                    : { borderColor: '#2A2A35', background: 'transparent', color: '#D1D5DB' }
                  }
                >{pm.PayMethodName}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={doConvert}
                disabled={!selectedPM || converting}
                className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: '#D6A84F', color: '#000' }}
              >
                {converting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                تحويل
              </button>
              <button onClick={() => setShowConvert(false)} className="px-4 py-2 rounded-xl text-sm text-zinc-400 border border-zinc-700">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {showReschedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border p-6 w-80 shadow-2xl" style={{ background: '#1A1A20', borderColor: '#2A2A35' }}>
            <h3 className="text-base font-bold text-white mb-4">إعادة جدولة</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">التاريخ الجديد</label>
                <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">الوقت الجديد</label>
                <input type="time" value={rescheduleTime} onChange={e => setRescheduleTime(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { doAction('reschedule', { rescheduleDate, rescheduleTime }); setShowReschedule(false); }}
                disabled={!rescheduleDate || !rescheduleTime || actLoading}
                className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: '#6366F1', color: '#fff' }}
              >تأكيد</button>
              <button onClick={() => setShowReschedule(false)} className="px-4 py-2 rounded-xl text-sm text-zinc-400 border border-zinc-700">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-2xl border p-6 w-80 shadow-2xl" style={{ background: '#1A1A20', borderColor: '#2A2A35' }}>
            <h3 className="text-base font-bold text-white mb-4">إلغاء الحجز</h3>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="سبب الإلغاء (اختياري)"
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none resize-none mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { doAction('cancel', { cancelReason: cancelReason || null }); setShowCancel(false); }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white"
              >تأكيد الإلغاء</button>
              <button onClick={() => setShowCancel(false)} className="px-4 py-2 rounded-xl text-sm text-zinc-400 border border-zinc-700">رجوع</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-[11px] text-zinc-500">{label}</p>
        <p className="text-sm text-white font-medium">{value}</p>
      </div>
    </div>
  );
}

function ActionBtn({ label, color, icon, onClick, loading }: {
  label: string; color: string; icon: React.ReactNode;
  onClick: () => void; loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-40"
      style={{ color, borderColor: `${color}44`, background: `${color}11` }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}
