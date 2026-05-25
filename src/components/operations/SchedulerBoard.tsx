'use client';

import { useMemo, useState, useCallback } from 'react';
import { BarberLane } from './BarberLane';
import { TimeAxis } from './TimeAxis';
import { BookingDetailsModal } from './BookingDetailsModal';
import { generateOperationalHours, HOUR_CELL_HEIGHT, TimelineItem } from './schedulerUtils';
import type { Booking } from '@/lib/operationsTypes';

interface Barber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'unknown';
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: TimelineItem[];
}

interface Props {
  barbers: Barber[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
  voiceEnabled?: boolean;
  onReannounce?: (ticketId: number) => Promise<boolean>;
  announcedIds?: Set<string>;
}

const HEADER_HEIGHT = 80;

export function SchedulerBoard({ barbers, loading, error, onRetry, onRefresh, voiceEnabled, onReannounce, announcedIds }: Props) {
  const hours = useMemo(() => generateOperationalHours(), []);
  const [selectedItem, setSelectedItem] = useState<TimelineItem | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Show all barbers (working, off, day_off) but not 'unknown'
  const displayBarbers = useMemo(() => {
    return barbers.filter(b => b.status !== 'unknown');
  }, [barbers]);

  const totalHeight = hours.length * HOUR_CELL_HEIGHT + HEADER_HEIGHT;

  const handleItemClick = useCallback((item: TimelineItem) => {
    setSelectedItem(item);
    setShowModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setSelectedItem(null);
  }, []);

  const handleDeleteBooking = useCallback(async (bookingId: number) => {
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'فشل حذف الحجز');
    }

    // Refresh the scheduler board
    if (onRefresh) {
      onRefresh();
    }
  }, [onRefresh]);

  const handleCancelQueueTicket = useCallback(async (ticketId: number) => {
    const res = await fetch(`/api/operations/queue/${ticketId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'إلغاء من لوحة التشغيل' }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'فشل إلغاء الدور');
    }

    // Refresh the scheduler board
    if (onRefresh) {
      onRefresh();
    }
  }, [onRefresh]);

  const handleEditBooking = useCallback((booking: Booking) => {
    // For now, show alert that edit is coming soon
    // In the future, this would open an edit modal
    alert('ميزة التعديل سيتم تفعيلها بعد ربط endpoint التعديل الكامل');
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#d4af37' }} />
          <p className="text-zinc-500">جاري تحميل لوحة التشغيل...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-lg border hover:bg-zinc-800 transition-colors"
            style={{ borderColor: 'rgba(212, 175, 55, 0.3)', color: '#d4af37' }}
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (displayBarbers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#050505' }}>
        <div className="text-center">
          <p className="text-zinc-400 mb-2">لا يوجد حلاقين متاحين اليوم</p>
          <p className="text-sm text-zinc-600">جميع الحلاقين في إجازة أو خارج ساعات العمل</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-auto"
      style={{ background: '#050505' }}
      dir="rtl"
    >
      <div className="min-w-max">
        {/* Scheduler Grid - Horizontal Scroll Container */}
        <div
          className="flex"
          style={{
            height: totalHeight,
          }}
        >
          {/* Time Axis - Sticky Left */}
          <TimeAxis headerHeight={HEADER_HEIGHT} />

          {/* Barber Lanes - Horizontal Scroll */}
          <div className="flex">
            {displayBarbers.map(barber => (
              <BarberLane
                key={barber.empId}
                barber={barber}
                headerHeight={HEADER_HEIGHT}
                onItemClick={handleItemClick}
                voiceEnabled={voiceEnabled}
                onReannounce={onReannounce}
                announcedIds={announcedIds}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Booking Details Modal */}
      {showModal && selectedItem && (
        <BookingDetailsModal
          item={selectedItem}
          onClose={handleCloseModal}
          onDelete={selectedItem.type === 'booking' ? handleDeleteBooking : undefined}
          onEdit={selectedItem.type === 'booking' ? handleEditBooking : undefined}
          onCancel={selectedItem.type === 'queue' ? handleCancelQueueTicket : undefined}
        />
      )}
    </div>
  );
}
