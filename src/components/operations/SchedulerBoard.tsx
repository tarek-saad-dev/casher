'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { LocateFixed } from 'lucide-react';
import { BarberLane } from './BarberLane';
import { TimeAxis } from './TimeAxis';
import { BookingDetailsModal } from './BookingDetailsModal';
import { CurrentTimeLine } from './CurrentTimeLine';
import { BookingRescheduleConfirmDialog } from './BookingRescheduleConfirmDialog';
import { BookingTimeAdjustSheet } from './BookingTimeAdjustSheet';
import { useTimelineAutoScroll } from './useTimelineAutoScroll';
import { useBookingDragReschedule } from './useBookingDragReschedule';
import { useBookingCutPaste } from './useBookingCutPaste';
import { BookingMoveModeBar } from './BookingMoveModeBar';
import { BookingCutPasteConfirmSheet } from './BookingCutPasteConfirmSheet';
import {
  generateOperationalHours,
  HOUR_CELL_HEIGHT,
  TimelineItem,
  FreeSegment,
  UNDO_TIMEOUT_MS,
} from './schedulerUtils';
import { OPS_LAYOUT } from './operationsLayout.constants';
import type { Booking } from '@/lib/operationsTypes';
import type { MobileBarberSelection } from './BarberMobileSelector';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Barber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
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
  onEmptyCellClick?: (hour: number, barber: Barber) => void;
  onFreeSegmentClick?: (segment: FreeSegment, barber: Barber, hour: number) => void;
  currentDate?: string;
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  mobileBarberSelection?: MobileBarberSelection;
  className?: string;
  onBarberQueueClick?: (barber: Barber) => void;
  barberQueueLoadingEmpId?: number | null;
  barberQueueSourceEmpId?: number | null;
  canCreateQueue?: boolean;
}

export const BARBER_COLORS = [
  { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.45)', text: '#34D399', dot: '#10B981', label: 'green' },
  { bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.45)', text: '#60A5FA', dot: '#3B82F6', label: 'blue' },
  { bg: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.45)', text: '#C084FC', dot: '#A855F7', label: 'purple' },
  { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.45)', text: '#FBBF24', dot: '#F59E0B', label: 'amber' },
  { bg: 'rgba(236, 72, 153, 0.12)', border: 'rgba(236, 72, 153, 0.45)', text: '#F472B6', dot: '#EC4899', label: 'pink' },
  { bg: 'rgba(20, 184, 166, 0.12)', border: 'rgba(20, 184, 166, 0.45)', text: '#2DD4BF', dot: '#14B8A6', label: 'teal' },
  { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.45)', text: '#F87171', dot: '#EF4444', label: 'red' },
  { bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.45)', text: '#818CF8', dot: '#6366F1', label: 'indigo' },
] as const;

export type BarberColor = (typeof BARBER_COLORS)[number];

export function getBarberColor(empId: number | null | undefined, index?: number): BarberColor {
  if (empId) {
    return BARBER_COLORS[Math.abs(Number(empId)) % BARBER_COLORS.length];
  }
  if (index !== undefined) {
    return BARBER_COLORS[index % BARBER_COLORS.length];
  }
  return BARBER_COLORS[0];
}

export function SchedulerBoard({
  barbers,
  loading,
  error,
  onRetry,
  onRefresh,
  voiceEnabled,
  onReannounce,
  onEmptyCellClick,
  onFreeSegmentClick,
  currentDate,
  addToast,
  mobileBarberSelection = 'all',
  className,
  onBarberQueueClick,
  barberQueueLoadingEmpId = null,
  barberQueueSourceEmpId = null,
  canCreateQueue = true,
}: Props) {
  const hours = useMemo(() => generateOperationalHours(), []);
  const [selectedItem, setSelectedItem] = useState<TimelineItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const undoActionRef = useRef<(() => void) | null>(null);
  const [timeAdjustItem, setTimeAdjustItem] = useState<TimelineItem | null>(null);
  const [rescheduleToast, setRescheduleToast] = useState<{
    message: string;
    ok: boolean;
    showUndo?: boolean;
  } | null>(null);

  const displayBarbers = useMemo(
    () => barbers.filter((b) => b.status !== 'unknown'),
    [barbers],
  );

  const handleRescheduleToast = useCallback(
    (message: string, ok: boolean, undo?: () => void) => {
      undoActionRef.current = undo ?? null;
      setRescheduleToast({ message, ok, showUndo: !!undo });
      setTimeout(() => {
        setRescheduleToast(null);
        undoActionRef.current = null;
      }, UNDO_TIMEOUT_MS);
      addToast?.(ok ? 'success' : 'error', message);
    },
    [addToast],
  );

  const drag = useBookingDragReschedule({
    operationalDate: currentDate,
    barbers: displayBarbers,
    scrollRef: desktopScrollRef,
    onRefresh,
    onToast: handleRescheduleToast,
  });

  const cutPaste = useBookingCutPaste({
    operationalDate: currentDate,
    barbers: displayBarbers,
    onRefresh,
    onToast: handleRescheduleToast,
  });

  const cutPasteHandlers = {
    moveSession: cutPaste.moveSession,
    isCommitting: cutPaste.isCommitting,
    onCut: (item: TimelineItem) => {
      const barber = displayBarbers.find((b) =>
        b.timeline.some((t) => t.type === 'booking' && t.sourceId === item.sourceId),
      );
      if (barber) {
        cutPaste.cutBooking(item, barber.empId, barber.empName);
      }
    },
    onSelectPaste: cutPaste.selectPasteSlot,
  };

  const getCutPasteForBarber = (empId: number) => ({
    ...cutPasteHandlers,
    pasteSlots: cutPaste.candidatesByEmpId.get(empId) ?? [],
  });

  const dragHandlers = {
    activeDrag: drag.activeDrag,
    dragPressBookingId: drag.dragPressBookingId,
    onCardPointerDown: drag.handlePointerDown,
    shouldSuppressCardClick: drag.shouldSuppressCardClick,
    onOpenTimeAdjust: setTimeAdjustItem,
  };

  const headerHeight = OPS_LAYOUT.HEADER_HEIGHT;
  const totalHeight = hours.length * HOUR_CELL_HEIGHT + headerHeight;

  const desktopMinWidth =
    OPS_LAYOUT.TIME_AXIS_WIDTH + displayBarbers.length * OPS_LAYOUT.BARBER_MIN_WIDTH;

  const mobileBarbers = useMemo(() => {
    if (mobileBarberSelection === 'all') return displayBarbers;
    return displayBarbers.filter((b) => b.empId === mobileBarberSelection);
  }, [displayBarbers, mobileBarberSelection]);

  const { showReturnToNow, scrollToCurrentTime } = useTimelineAutoScroll({
    selectedDate: currentDate,
    headerHeight,
    laneHeight: totalHeight,
    loading: !!loading,
    hasBarbers: displayBarbers.length > 0,
    mobileBarberSelection,
    desktopScrollRef,
    mobileScrollRef,
    barbers: displayBarbers,
  });

  const handleItemClick = useCallback((item: TimelineItem) => {
    setSelectedItem(item);
    setShowModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
    setSelectedItem(null);
  }, []);

  const handleDeleteBooking = useCallback(
    async (bookingId: number) => {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'فشل حذف الحجز');
      }

      onRefresh?.();
    },
    [onRefresh],
  );

  const handleCancelQueueTicket = useCallback(
    async (ticketId: number) => {
      const res = await fetch(`/api/operations/queue/${ticketId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'إلغاء من لوحة التشغيل' }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'فشل إلغاء الدور');
      }

      setTimeout(() => onRefresh?.(), 300);
    },
    [onRefresh],
  );

  const handleTransferQueueTicket = useCallback(
    async (ticketId: number, newEmpId: number) => {
      const res = await fetch(`/api/queue/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'transfer', transferEmpId: newEmpId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'فشل نقل الدور');
      }

      setTimeout(() => onRefresh?.(), 300);
    },
    [onRefresh],
  );

  const handleEditBooking = useCallback((_booking: Booking) => {
    alert('ميزة التعديل سيتم تفعيلها بعد ربط endpoint التعديل الكامل');
  }, []);

  const laneProps = {
    headerHeight,
    onItemClick: handleItemClick,
    voiceEnabled,
    onReannounce,
    onEmptyCellClick,
    onFreeSegmentClick,
    currentDate,
    onQueueClick: onBarberQueueClick,
    canCreateQueue,
    scheduleLoading: !!loading,
  };

  const getQueueLaneProps = (empId: number) => ({
    ...laneProps,
    queueButtonLoading: barberQueueLoadingEmpId === empId,
    queueSourceHighlighted: barberQueueSourceEmpId === empId,
  });

  if (loading) {
    return (
      <div className={cn('flex flex-1 items-center justify-center rounded-2xl border border-border/60 bg-card/40', className)}>
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">جاري تحميل لوحة التشغيل...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-1 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/5', className)}>
        <div className="text-center">
          <p className="mb-4 text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl border border-border px-4 py-2 text-sm text-primary transition-colors hover:bg-surface-muted"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (displayBarbers.length === 0) {
    return (
      <div className={cn('flex flex-1 items-center justify-center rounded-2xl border border-border/60 bg-card/40', className)}>
        <div className="text-center">
          <p className="mb-2 text-sm text-muted-foreground">لا يوجد حلاقين متاحين اليوم</p>
          <p className="text-xs text-muted-foreground/70">جميع الحلاقين في إجازة أو خارج ساعات العمل</p>
        </div>
      </div>
    );
  }

  return (
    <section
      className={cn(
        'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/30 shadow-sm',
        className,
      )}
      dir="rtl"
    >
      {cutPaste.moveSession && (
        <BookingMoveModeBar
          session={cutPaste.moveSession}
          onCancel={cutPaste.cancelMove}
          onReturnToOriginal={() => {
            const slot = cutPaste.pasteCandidates.find(
              (s) =>
                s.empId === cutPaste.moveSession!.originalEmpId
                && s.startIso === cutPaste.moveSession!.originalStartAt,
            );
            if (slot) {
              void cutPaste.selectPasteSlot(slot);
            } else {
              cutPaste.cancelMove();
            }
          }}
        />
      )}

      {showReturnToNow && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center px-3">
          <Button
            type="button"
            size="sm"
            onClick={() => scrollToCurrentTime('smooth')}
            className="pointer-events-auto h-10 gap-1.5 rounded-full border border-success/30 bg-card/95 px-4 text-success shadow-lg backdrop-blur-sm hover:bg-success/10"
            aria-label="العودة للوقت الحالي"
            title="العودة للوقت الحالي"
          >
            <LocateFixed className="size-4" />
            العودة للوقت الحالي
          </Button>
        </div>
      )}

      {/* Desktop / tablet board */}
      <div
        ref={desktopScrollRef}
        className="hidden min-h-0 flex-1 overflow-auto scrollbar-luxury-v md:block"
      >
        <div
          className="flex w-full min-w-full"
          style={{ minWidth: `max(100%, ${desktopMinWidth}px)`, height: totalHeight }}
        >
          <TimeAxis headerHeight={headerHeight} />

          <div className="relative flex min-w-0 flex-1">
            <CurrentTimeLine headerHeight={headerHeight} selectedDate={currentDate} />

            {displayBarbers.map((barber, index) => (
              <BarberLane
                key={barber.empId}
                barber={barber}
                color={getBarberColor(barber.empId, index)}
                drag={dragHandlers}
                cutPaste={getCutPasteForBarber(barber.empId)}
                {...getQueueLaneProps(barber.empId)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile board */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden">
        <div
          ref={mobileScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-20 scrollbar-luxury-v"
        >
          {mobileBarberSelection === 'all' ? (
            <div className="space-y-4 p-2">
              {displayBarbers.map((barber, index) => (
                <div
                  key={barber.empId}
                  className="overflow-hidden rounded-xl border border-border/70 bg-card/50"
                >
                  <BarberLane
                    barber={barber}
                    color={getBarberColor(barber.empId, index)}
                    fullWidth
                    drag={dragHandlers}
                    cutPaste={getCutPasteForBarber(barber.empId)}
                    {...getQueueLaneProps(barber.empId)}
                  />
                </div>
              ))}
            </div>
          ) : (
            mobileBarbers.map((barber, index) => (
              <div
                key={barber.empId}
                className="flex w-full"
                style={{ minHeight: totalHeight }}
              >
                <TimeAxis headerHeight={headerHeight} />
                <div className="relative min-w-0 flex-1">
                  <CurrentTimeLine headerHeight={headerHeight} selectedDate={currentDate} />
                  <BarberLane
                    barber={barber}
                    color={getBarberColor(barber.empId, index)}
                    fullWidth
                    drag={dragHandlers}
                    cutPaste={getCutPasteForBarber(barber.empId)}
                    {...getQueueLaneProps(barber.empId)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <BookingCutPasteConfirmSheet
        open={cutPaste.mobileConfirmOpen}
        session={cutPaste.moveSession}
        pending={cutPaste.pendingPaste}
        isCommitting={cutPaste.isCommitting}
        fallbackSlots={cutPaste.pasteCandidates.slice(0, 12)}
        onConfirm={cutPaste.confirmMobilePaste}
        onCancel={cutPaste.closeMobileConfirm}
        onSelectSlot={(empId, startIso, endIso, empName) => {
          cutPaste.selectPasteSlot({
            empId,
            empName,
            startIso,
            endIso,
            topPx: 0,
            heightPx: 0,
          });
        }}
      />

      {rescheduleToast?.showUndo && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/70 bg-card/95 px-4 py-2 text-sm shadow-lg backdrop-blur-sm">
            <span>{rescheduleToast.message}</span>
            <button
              type="button"
              className="font-semibold text-primary hover:underline"
              onClick={() => {
                undoActionRef.current?.();
                setRescheduleToast(null);
              }}
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      <BookingRescheduleConfirmDialog
        open={!!drag.confirmMove}
        label={drag.confirmMove?.label ?? ''}
        confirming={drag.isConfirmingMove}
        onConfirm={drag.confirmPendingMove}
        onCancel={drag.cancelPendingMove}
      />

      <BookingTimeAdjustSheet
        open={!!timeAdjustItem}
        item={timeAdjustItem}
        onClose={() => setTimeAdjustItem(null)}
        onAdjust={(delta) => {
          if (timeAdjustItem) drag.applyTimeAdjust(timeAdjustItem, delta);
        }}
      />

      {showModal && selectedItem && (
        <BookingDetailsModal
          item={selectedItem}
          onClose={handleCloseModal}
          onDelete={selectedItem.type === 'booking' ? handleDeleteBooking : undefined}
          onEdit={selectedItem.type === 'booking' ? handleEditBooking : undefined}
          onCancel={selectedItem.type === 'queue' ? handleCancelQueueTicket : undefined}
          onTransfer={selectedItem.type === 'queue' ? handleTransferQueueTicket : undefined}
          barbers={displayBarbers.map((b) => ({
            empId: b.empId,
            empName: b.empName,
            status: b.status,
          }))}
          addToast={addToast}
        />
      )}
    </section>
  );
}
