'use client';

import { X, Pencil, XCircle, Calendar, Clock, User, Phone, Scissors, Receipt, FileText, Tag, AlertCircle, Loader2, Printer, ArrowLeftRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Booking } from '@/lib/operationsTypes';
import { TimelineItem } from './schedulerUtils';
import { printBookingTicket, BookingTicketData } from '@/lib/printBookingTicket';

interface Barber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
}

interface Props {
  item: TimelineItem;
  onClose: () => void;
  onDelete?: (bookingId: number) => Promise<void>;
  onEdit?: (booking: Booking) => void;
  onCancel?: (ticketId: number) => Promise<void>;
  onTransfer?: (ticketId: number, newEmpId: number) => Promise<void>;
  barbers?: Barber[];
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
}

interface BookingDetails extends Booking {
  services?: Array<{
    ProName?: string;
    Price?: number;
    EmpName?: string;
  }>;
  // Normalized Cairo time fields from API
  startDateTimeCairo?: string;
  endDateTimeCairo?: string;
  startTimeDisplay?: string;
  endTimeDisplay?: string;
  dateDisplay?: string;
  durationMinutes?: number;
  // Debug fields
  _rawStartTime?: string;
  _rawEndTime?: string;
  _rawBookingDate?: string;
}

export function BookingDetailsModal({ item, onClose, onDelete, onEdit, onCancel, onTransfer, barbers, addToast }: Props) {
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [selectedBarber, setSelectedBarber] = useState<number | null>(null);

  // Fetch booking details
  useEffect(() => {
    const fetchDetails = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/bookings/${item.sourceId}`);
        if (!res.ok) throw new Error('فشل تحميل تفاصيل الحجز');
        const data = await res.json();
        setBooking(data.booking);
        // Merge services into booking object
        if (data.services) {
          setBooking(prev => prev ? { ...prev, services: data.services } : null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ');
      } finally {
        setLoading(false);
      }
    };

    if (item.type === 'booking') {
      fetchDetails();
    } else {
      // For queue items, create a mock booking from the timeline item
      setBooking({
        BookingID: item.sourceId,
        ClientName: item.customerName || item.label,
        Status: item.status,
        StartTime: item.startTime,
        EndTime: item.endTime,
        Notes: null,
        ServiceCount: 0,
      } as BookingDetails);
      setLoading(false);
    }
  }, [item]);

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(item.sourceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حذف الحجز');
    } finally {
      setDeleting(false);
    }
  };

  const handleCancel = async () => {
    if (!onCancel) return;
    setCancelling(true);
    try {
      await onCancel(item.sourceId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إلغاء الدور');
    } finally {
      setCancelling(false);
    }
  };

  const handleTransfer = async () => {
    if (!onTransfer || !selectedBarber) return;
    setTransferring(true);
    try {
      await onTransfer(item.sourceId, selectedBarber);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل نقل الدور');
    } finally {
      setTransferring(false);
    }
  };

  const handleEdit = () => {
    if (!booking || !onEdit) {
      // Fallback: show info that edit is not available
      alert('ميزة التعديل سيتم تفعيلها بعد ربط endpoint');
      return;
    }
    onEdit(booking);
  };

  const handlePrint = async () => {
    if (!booking) return;
    setPrinting(true);
    try {
      // DEBUG for BK-448
      const isDebug = booking.BookingID === 448 || item.sourceId === 448;
      if (isDebug) {
        console.log('[BookingDetailsModal handlePrint BK-448] Building ticket data:', {
          bookingNormalizedFields: {
            startTimeDisplay: booking.startTimeDisplay,
            endTimeDisplay: booking.endTimeDisplay,
            dateDisplay: booking.dateDisplay,
            startDateTimeCairo: booking.startDateTimeCairo,
            endDateTimeCairo: booking.endDateTimeCairo,
          },
          itemNormalizedFields: {
            startTimeDisplay: item.startTimeDisplay,
            endTimeDisplay: item.endTimeDisplay,
            dateDisplay: item.dateDisplay,
          },
        });
      }

      const ticketData: BookingTicketData = {
        bookingId: booking.BookingID,
        bookingCode: `BK-${booking.BookingID}`,
        customerName: booking.ClientName || item.customerName || '—',
        customerPhone: booking.ClientMobile || undefined,
        empName: booking.EmpName || '—',
        services: booking.services?.map(s => ({
          name: s.ProName || 'خدمة',
          durationMinutes: undefined,
          price: s.Price,
        })) || [],
        // Raw fields (for backwards compatibility)
        bookingDate: booking.BookingDate || item.startTime,
        startTime: booking.StartTime || item.startTime,
        endTime: booking.EndTime || item.endTime,
        durationMinutes: booking.durationMinutes || item.durationMinutes,
        status: booking.Status || item.status,
        notes: booking.Notes,
        // Normalized Cairo display fields (preferred for print)
        // Use booking fields first, fallback to timeline item fields
        startTimeDisplay: booking.startTimeDisplay || item.startTimeDisplay,
        endTimeDisplay: booking.endTimeDisplay || item.endTimeDisplay,
        dateDisplay: booking.dateDisplay || item.dateDisplay,
        startDateTimeCairo: booking.startDateTimeCairo,
        endDateTimeCairo: booking.endDateTimeCairo,
      };

      if (isDebug) {
        console.log('[BookingDetailsModal handlePrint BK-448] Final ticketData:', {
          startTimeDisplay: ticketData.startTimeDisplay,
          endTimeDisplay: ticketData.endTimeDisplay,
          dateDisplay: ticketData.dateDisplay,
        });
      }

      await printBookingTicket(ticketData, addToast);
    } catch (err) {
      console.error('[BookingDetailsModal] Print error:', err);
      addToast?.('error', 'تعذر الطباعة، حاول مرة أخرى');
    } finally {
      setPrinting(false);
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'معلق',
      confirmed: 'مؤكد',
      arrived: 'وصل',
      queued: 'في الدور',
      in_service: 'قيد الخدمة',
      completed: 'مكتمل',
      cancelled: 'ملغي',
      no_show: 'لم يحضر',
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending:    'var(--warning)',
      confirmed:  'var(--success)',
      arrived:    'var(--accent)',
      queued:     'var(--info)',
      in_service: 'var(--primary)',
      completed:  'var(--success)',
      cancelled:  'var(--destructive)',
      no_show:    'var(--muted-foreground)',
    };
    return colors[status] || 'var(--muted-foreground)';
  };

  // DEBUG for BK-448
  useEffect(() => {
    if (booking?.BookingID === 448 || item.sourceId === 448) {
      console.log('[BookingDetailsModal BK-448] item:', item);
      console.log('[BookingDetailsModal BK-448] booking:', booking);
      console.log('[BookingDetailsModal BK-448] Using display fields:', {
        itemStartDisplay: item.startTimeDisplay,
        itemEndDisplay: item.endTimeDisplay,
        bookingStartDisplay: booking?.startTimeDisplay,
        bookingEndDisplay: booking?.endTimeDisplay,
      });
    }
  }, [booking, item]);

  // Format date and time - prefer normalized display fields
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // Use normalized display fields if available, otherwise fall back to parsing ISO strings
  const formatTime = (timeStr: string, displayTime?: string) => {
    // Prefer pre-formatted display time from normalized fields
    if (displayTime) return displayTime;

    if (!timeStr) return '—';
    // Handle ISO string or time string
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) {
      // Try parsing as time string HH:mm:ss
      const [h, m] = timeStr.split(':');
      if (h && m) {
        const hour = parseInt(h);
        const minute = parseInt(m);
        const period = hour >= 12 ? 'م' : 'ص';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
      }
      return timeStr;
    }
    return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  };

  // Calculate duration
  const getDuration = () => {
    if (item.durationMinutes) return `${item.durationMinutes} دقيقة`;
    if (booking?.StartTime && booking?.EndTime) {
      const start = new Date(booking.StartTime);
      const end = new Date(booking.EndTime);
      const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
      return `${minutes} دقيقة`;
    }
    return '—';
  };

  // Get total price
  const getTotalPrice = () => {
    if (!booking?.services?.length) return null;
    return booking.services.reduce((sum, s) => sum + (s.Price || 0), 0);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 backdrop-blur-sm" onClick={onClose}>
        <div className="flex items-center gap-3 p-6 rounded-xl" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--surface-muted)' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
          <span className="text-foreground">جاري تحميل التفاصيل...</span>
        </div>
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 backdrop-blur-sm" onClick={onClose}>
        <div className="flex flex-col items-center gap-4 p-6 rounded-xl max-w-sm" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--surface-muted)' }}>
          <AlertCircle size={32} style={{ color: 'var(--destructive)' }} />
          <p className="text-destructive text-center">{error}</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--foreground)' }}>
            إغلاق
          </button>
        </div>
      </div>
    );
  }

  const statusColor = getStatusColor(booking?.Status || item.status);
  const statusLabel = getStatusLabel(booking?.Status || item.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative rounded-2xl border shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        style={{ background: 'var(--surface-elevated)', borderColor: 'var(--surface-muted)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--surface-muted)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-3">
            <div
              className="px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: statusColor + '22', color: statusColor, border: `1px solid ${statusColor}44` }}
            >
              {item.type === 'booking' ? 'حجز' : 'دور'}
            </div>
            <span className="text-lg font-bold text-foreground">BK-{item.sourceId}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-surface-muted transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Customer Info */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">معلومات العميل</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--surface)' }}>
                <User size={16} style={{ color: 'var(--primary)' }} />
                <div>
                  <div className="text-[10px] text-muted-foreground/70">الاسم</div>
                  <div className="text-sm font-medium text-foreground">{booking?.ClientName || item.customerName || '—'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--surface)' }}>
                <Phone size={16} style={{ color: 'var(--primary)' }} />
                <div>
                  <div className="text-[10px] text-muted-foreground/70">الهاتف</div>
                  <div className="text-sm font-medium text-foreground" dir="ltr">{booking?.ClientMobile || '—'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Booking Info */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">معلومات الحجز</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--surface)' }}>
                <Calendar size={16} style={{ color: 'var(--primary)' }} />
                <div>
                  <div className="text-[10px] text-muted-foreground/70">التاريخ</div>
                  <div className="text-sm font-medium text-foreground">
                    {/* Prefer normalized display date, fallback to parsing */}
                    {booking?.dateDisplay || item.dateDisplay || formatDate(booking?.BookingDate || item.startTime)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--surface)' }}>
                <Clock size={16} style={{ color: 'var(--primary)' }} />
                <div>
                  <div className="text-[10px] text-muted-foreground/70">الوقت</div>
                  <div className="text-sm font-medium text-foreground">
                    {/* Use normalized display fields for consistent Cairo time display */}
                    {formatTime(booking?.StartTime || item.startTime, booking?.startTimeDisplay || item.startTimeDisplay)}
                    {' — '}
                    {formatTime(booking?.EndTime || item.endTime, booking?.endTimeDisplay || item.endTimeDisplay)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--surface)' }}>
                <Tag size={16} style={{ color: 'var(--primary)' }} />
                <div>
                  <div className="text-[10px] text-muted-foreground/70">المدة</div>
                  <div className="text-sm font-medium text-foreground">{getDuration()}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--surface)' }}>
                <Scissors size={16} style={{ color: 'var(--primary)' }} />
                <div>
                  <div className="text-[10px] text-muted-foreground/70">الحلاق</div>
                  <div className="text-sm font-medium text-foreground">{booking?.EmpName || '—'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: statusColor + '15', border: `1px solid ${statusColor}30` }}>
            <div className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
            <span className="text-sm font-medium" style={{ color: statusColor }}>{statusLabel}</span>
          </div>

          {/* Services */}
          {booking?.services && booking.services.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">الخدمات</h3>
              <div className="space-y-1">
                {booking.services.map((svc, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--surface)' }}>
                    <div className="flex items-center gap-2">
                      <Receipt size={14} style={{ color: 'var(--primary)' }} />
                      <span className="text-sm text-foreground">{svc.ProName || 'خدمة'}</span>
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--primary)' }}>{svc.Price?.toFixed(2) || '—'} ج.م</span>
                  </div>
                ))}
                {getTotalPrice() && (
                  <div className="flex items-center justify-between p-2 rounded-lg mt-2" style={{ background: 'var(--primary)20', border: '1px solid var(--primary)40' }}>
                    <span className="text-sm font-medium text-foreground">الإجمالي</span>
                    <span className="text-sm font-bold" style={{ color: 'var(--primary)' }}>{getTotalPrice()?.toFixed(2)} ج.م</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {booking?.Notes && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">ملاحظات</h3>
              <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: 'var(--surface)' }}>
                <FileText size={16} style={{ color: 'var(--primary)', marginTop: '2px' }} />
                <p className="text-sm text-foreground">{booking.Notes}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t flex gap-3" style={{ borderColor: 'var(--surface-muted)', background: 'var(--surface)' }}>
          {item.type === 'booking' ? (
            <>
              {/* Print Booking Ticket Button */}
              <button
                onClick={handlePrint}
                disabled={printing}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
                style={{ borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)', color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 7%, transparent)' }}
              >
                {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                {printing ? 'جاري الطباعة...' : 'طباعة ورقة الحجز'}
              </button>
              <button
                disabled
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all opacity-50 cursor-not-allowed"
                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)', background: 'var(--muted-foreground)/5' }}
                title="تعديل الحجز سيتم تفعيله في المرحلة القادمة"
              >
                <Pencil size={16} />
                تعديل قريبًا
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
                style={{ borderColor: 'color-mix(in srgb, var(--destructive) 25%, transparent)', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 7%, transparent)' }}
              >
                <XCircle size={16} />
                إلغاء الحجز
              </button>
            </>
          ) : item.type === 'queue' && onCancel ? (
            <>
              {onTransfer && barbers && barbers.length > 0 && (
                <button
                  onClick={() => setShowTransfer(true)}
                  disabled={transferring}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 7%, transparent)' }}
                >
                  <ArrowLeftRight size={16} />
                  نقل لحلاق آخر
                </button>
              )}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={cancelling}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
                style={{ borderColor: 'color-mix(in srgb, var(--destructive) 25%, transparent)', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 7%, transparent)' }}
              >
                <XCircle size={16} />
                {cancelling ? 'جاري الإلغاء...' : 'إلغاء الدور'}
              </button>
            </>
          ) : null}
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-surface-muted"
            style={{ color: 'var(--muted-foreground)', background: 'var(--surface-muted)' }}
          >
            إغلاق
          </button>
        </div>

        {/* Cancel Confirmation Dialog */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="mx-4 p-5 rounded-xl max-w-sm w-full" style={{ background: 'var(--surface)', border: '1px solid color-mix(in srgb, var(--destructive) 30%, transparent)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--destructive) 12%, transparent)' }}>
                  <XCircle size={20} style={{ color: 'var(--destructive)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">
                    {item.type === 'queue' ? 'إلغاء الدور' : 'إلغاء الحجز'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {item.type === 'queue' ? 'هل أنت متأكد من إلغاء هذا الدور؟' : 'هل أنت متأكد من إلغاء هذا الحجز؟'}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                سيتم إخفاؤه من جدول التشغيل ولن يتم احتسابه كـ {item.type === 'queue' ? 'دور' : 'حجز'} نشط.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-surface-muted"
                  style={{ color: 'var(--muted-foreground)', background: 'var(--surface-muted)' }}
                >
                  إلغاء
                </button>
                <button
                  onClick={item.type === 'queue' ? handleCancel : handleDelete}
                  disabled={deleting || cancelling}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ background: 'var(--destructive)', color: 'var(--foreground)' }}
                >
                  {deleting || cancelling ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'تأكيد الإلغاء'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transfer Dialog */}
        {showTransfer && barbers && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
            <div className="mx-4 p-5 rounded-xl max-w-sm w-full" style={{ background: 'var(--surface)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
                  <ArrowLeftRight size={20} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">نقل الدور لحلاق آخر</h3>
                  <p className="text-sm text-muted-foreground">اختر الحلاق الجديد لنقل {item.label} إليه</p>
                </div>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                {barbers
                  .filter(b => b.empId !== item.barberId)
                  .map(b => (
                    <button
                      key={b.empId}
                      onClick={() => setSelectedBarber(b.empId)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all"
                      style={{
                        borderColor: selectedBarber === b.empId ? 'var(--accent)' : 'var(--surface-muted)',
                        background: selectedBarber === b.empId ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                        color: b.status === 'working' ? 'var(--foreground)' : 'var(--muted-foreground)',
                      }}
                    >
                      <span className="font-medium">{b.empName}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: b.status === 'working' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--muted-foreground) 15%, transparent)',
                          color: b.status === 'working' ? 'var(--success)' : 'var(--muted-foreground)',
                        }}>
                        {b.status === 'working' ? 'متاح' : b.status === 'day_off' ? 'إجازة' : 'خارج الدوام'}
                      </span>
                    </button>
                  ))}
                {barbers.filter(b => b.empId !== item.barberId).length === 0 && (
                  <p className="text-muted-foreground/70 text-sm text-center py-4">لا يوجد حلاقون آخرون متاحون</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowTransfer(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all hover:bg-surface-muted"
                  style={{ color: 'var(--muted-foreground)', background: 'var(--surface-muted)' }}
                >
                  إلغاء
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={!selectedBarber || transferring}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--foreground)' }}
                >
                  {transferring ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'نقل'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
