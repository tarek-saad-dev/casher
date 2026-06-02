'use client';

import { X, Calendar, Clock, User, Scissors, Receipt, FileText, Tag, Loader2, Printer, Ticket } from 'lucide-react';
import { useState, useEffect } from 'react';
import { TimelineItem, formatOperationalHour } from './schedulerUtils';
import { printBookingTicket, BookingTicketData } from '@/lib/printBookingTicket';

interface Props {
  open: boolean;
  onClose: () => void;
  items: TimelineItem[];
  barberName?: string;
  hourLabel?: string;
  onOpenDetails?: (item: TimelineItem) => void;
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
}

interface BookingDetails {
  BookingID: number;
  BookingCode: string;
  ClientName: string;
  ClientMobile?: string;
  BarberName?: string;
  StartTime: string;
  EndTime?: string;
  Status: string;
  services?: Array<{
    ProName?: string;
    Price?: number;
  }>;
}

interface QueueDetails {
  QueueTicketID: number;
  TicketCode: string;
  CustomerName?: string;
  BarberName?: string;
  EstimatedStartTime?: string;
  Status: string;
  serviceNames?: string[];
}

export function MoreTimelineItemsModal({ open, onClose, items, barberName, hourLabel, onOpenDetails, addToast }: Props) {
  const [bookingDetails, setBookingDetails] = useState<Map<number, BookingDetails>>(new Map());
  const [queueDetails, setQueueDetails] = useState<Map<number, QueueDetails>>(new Map());
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const [printing, setPrinting] = useState<Set<number>>(new Set());

  // Fetch details for all items when modal opens
  useEffect(() => {
    if (!open) return;

    const fetchAllDetails = async () => {
      const bookingMap = new Map<number, BookingDetails>();
      const queueMap = new Map<number, QueueDetails>();
      const loadingSet = new Set<number>();

      for (const item of items) {
        loadingSet.add(item.sourceId);

        if (item.type === 'booking') {
          try {
            const res = await fetch(`/api/bookings/${item.sourceId}`);
            if (res.ok) {
              const data = await res.json();
              bookingMap.set(item.sourceId, {
                ...data.booking,
                services: data.services || [],
              });
            }
          } catch (err) {
            console.error('[MoreTimelineItemsModal] Failed to fetch booking:', err);
          }
        } else if (item.type === 'queue' || item.type === 'in_service') {
          // For queue items, use the timeline item data directly
          queueMap.set(item.sourceId, {
            QueueTicketID: item.sourceId,
            TicketCode: item.ticketCode || item.label,
            CustomerName: item.customerName,
            BarberName: barberName,
            EstimatedStartTime: item.startTime,
            Status: item.status,
            serviceNames: item.serviceNames,
          });
        }

        loadingSet.delete(item.sourceId);
      }

      setBookingDetails(bookingMap);
      setQueueDetails(queueMap);
      setLoading(loadingSet);
    };

    fetchAllDetails();
  }, [open, items, barberName]);

  // Sort items: bookings first, then by start time
  const sortedItems = [...items].sort((a, b) => {
    // Bookings come before queue items
    if (a.type === 'booking' && b.type !== 'booking') return -1;
    if (a.type !== 'booking' && b.type === 'booking') return 1;
    // Then sort by start time
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });

  const handlePrintBooking = async (item: TimelineItem) => {
    const booking = bookingDetails.get(item.sourceId);
    if (!booking) {
      addToast?.('error', 'بيانات الحجز غير متوفرة');
      return;
    }

    setPrinting(prev => new Set(prev).add(item.sourceId));

    try {
      const ticketData: BookingTicketData = {
        bookingId: booking.BookingID,
        bookingCode: booking.BookingCode,
        customerName: booking.ClientName,
        customerPhone: booking.ClientMobile,
        empName: booking.BarberName || barberName || '',
        services: (booking.services || []).map(s => ({
          name: s.ProName || '',
          price: s.Price,
        })).filter(s => s.name),
        bookingDate: new Date().toLocaleDateString('ar-EG'),
        startTime: booking.StartTime,
        status: booking.Status,
      };

      await printBookingTicket(ticketData, addToast);
    } catch (err) {
      console.error('[MoreTimelineItemsModal] Print error:', err);
      addToast?.('error', 'تعذر الطباعة');
    } finally {
      setPrinting(prev => {
        const next = new Set(prev);
        next.delete(item.sourceId);
        return next;
      });
    }
  };

  const formatTimeRange = (start: string, end?: string) => {
    const startTime = new Date(start).toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    if (!end) return startTime;
    const endTime = new Date(end).toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return `${startTime} - ${endTime}`;
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; color: string; bg: string }> = {
      confirmed: { label: 'مؤكد', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)' },
      arrived: { label: 'واصل', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
      waiting: { label: 'منتظر', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
      called: { label: 'تم النداء', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
      in_service: { label: 'قيد الخدمة', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' },
    };

    const mapped = statusMap[status.toLowerCase()];
    if (!mapped) return null;

    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded"
        style={{ color: mapped.color, background: mapped.bg }}
      >
        {mapped.label}
      </span>
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%)',
          border: '1px solid rgba(212, 175, 55, 0.3)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" style={{ color: '#d4af37' }} />
            <h2 className="text-base font-bold text-white">
              {hourLabel ? `العناصر في ${hourLabel}` : 'العناصر في هذا الوقت'}
            </h2>
            {barberName && (
              <span className="text-xs text-gray-400">({barberName})</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Items List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sortedItems.map((item, index) => {
            const isBooking = item.type === 'booking';
            const booking = isBooking ? bookingDetails.get(item.sourceId) : null;
            const queue = !isBooking ? queueDetails.get(item.sourceId) : null;
            const isLoading = loading.has(item.sourceId);
            const isPrinting = printing.has(item.sourceId);

            return (
              <div
                key={index}
                className="p-3 rounded-lg border transition-all hover:border-yellow-500/40"
                style={{
                  background: isBooking
                    ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(34, 197, 94, 0.02) 100%)'
                    : 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.02) 100%)',
                  borderColor: isBooking
                    ? 'rgba(34, 197, 94, 0.2)'
                    : 'rgba(59, 130, 246, 0.2)',
                }}
              >
                {/* Badge and Code */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        background: isBooking ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                        color: isBooking ? '#22c55e' : '#3b82f6',
                      }}
                    >
                      {isBooking ? 'حجز' : 'دور'}
                    </span>
                    <span className="text-sm font-bold text-white">
                      {isBooking ? booking?.BookingCode || item.label : queue?.TicketCode || item.ticketCode || item.label}
                    </span>
                  </div>
                  {getStatusBadge(isBooking ? booking?.Status || item.status : queue?.Status || item.status)}
                </div>

                {/* Customer Name */}
                <div className="flex items-center gap-2 mb-1.5">
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-sm text-gray-200">
                    {isLoading ? (
                      <span className="text-gray-500">جاري التحميل...</span>
                    ) : isBooking ? (
                      booking?.ClientName || item.customerName || '—'
                    ) : (
                      queue?.CustomerName || item.customerName || 'عميل مباشر'
                    )}
                  </span>
                </div>

                {/* Time */}
                <div className="flex items-center gap-2 mb-1.5">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-400">
                    {formatTimeRange(item.startTime, item.endTime)}
                  </span>
                </div>

                {/* Barber */}
                <div className="flex items-center gap-2 mb-1.5">
                  <Receipt className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-400">
                    الحلاق: {isBooking ? booking?.BarberName || barberName : barberName}
                  </span>
                </div>

                {/* Services */}
                {((isBooking ? booking?.services?.length : queue?.serviceNames?.length) || 0) > 0 && (
                  <div className="flex items-start gap-2 mb-2">
                    <Scissors className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {(isBooking ? booking?.services?.map(s => s.ProName) : queue?.serviceNames)
                        ?.filter((s): s is string => Boolean(s))
                        .map((svc, i) => (
                          <span
                            key={i}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-300"
                          >
                            {svc}
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-white/5">
                  <button
                    onClick={() => onOpenDetails?.(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:bg-white/10"
                    style={{ color: '#d4af37' }}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    تفاصيل
                  </button>

                  {isBooking && (
                    <button
                      onClick={() => handlePrintBooking(item)}
                      disabled={isPrinting || !booking}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:bg-white/10 disabled:opacity-50"
                      style={{ color: '#22c55e' }}
                    >
                      {isPrinting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Printer className="w-3.5 h-3.5" />
                      )}
                      طباعة
                    </button>
                  )}

                  {!isBooking && (
                    <button
                      onClick={() => onOpenDetails?.(item)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:bg-white/10"
                      style={{ color: '#3b82f6' }}
                    >
                      <Ticket className="w-3.5 h-3.5" />
                      ورقة الدور
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2 border-t text-center"
          style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}
        >
          <span className="text-xs text-gray-500">
            {items.length} عنصر في هذا الوقت
          </span>
        </div>
      </div>
    </div>
  );
}
