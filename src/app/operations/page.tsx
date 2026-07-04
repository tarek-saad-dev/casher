'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SchedulerBoard } from '@/components/operations/SchedulerBoard';
import { BottomSummaryStrip } from '@/components/operations/BottomSummaryStrip';
import { SimpleCreateQueueDrawer } from '@/components/operations/SimpleCreateQueueDrawer';
import { FindNearestQueueDrawer } from '@/components/operations/FindNearestQueueDrawer';
import { CreateBookingDrawer } from '@/components/operations/CreateBookingDrawer';
import { ScheduleControlModal } from '@/components/operations/ScheduleControlModal';
import { OperationsControlPanel } from '@/components/operations/OperationsControlPanel';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import {
  createQueueResponseToPrintData,
  formatQuickQueueSuccessToast,
} from '@/lib/quickQueueClient';
import { printQueueTicket, printQueueTicketInWindow } from '@/lib/printQueueTicket';
import { BarberMobileSelector, type MobileBarberSelection } from '@/components/operations/BarberMobileSelector';
import { MobileOperationsActions } from '@/components/operations/MobileOperationsActions';
import { OPS_LAYOUT } from '@/components/operations/operationsLayout.constants';
import { getCairoBusinessDate } from '@/components/operations/schedulerUtils';
import { QUICK_QUEUE_UI_ENABLED } from '@/lib/quickQueueConfig';
import { useAutoVoiceAnnounce, isVoiceEnabled, enableVoice, disableVoice } from '@/hooks/useAutoVoiceAnnounce';

interface FlowBoardBarber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
  isWorkingDay?: boolean;
  isDayOff?: boolean;
  isAbsent?: boolean;
  isLateStart?: boolean;
  isEarlyLeave?: boolean;
  currentAvailabilityStatus?: string;
  statusReasonArabic?: string;
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: Array<{
    type: 'queue' | 'booking' | 'gap' | 'in_service';
    sourceId: number;
    label: string;
    startTime: string;
    endTime: string;
    status: string;
    protected: boolean;
    customerName?: string;
    durationMinutes?: number;
    ticketCode?: string;
    effectiveStatus?: string;
    actualStatus?: string;
    needsOperatorAction?: boolean;
    overdueMinutes?: number;
    expectedStartAt?: string;
    expectedEndAt?: string;
    isCountingAhead?: boolean;
    isBlockingAvailability?: boolean;
    startTimeDisplay?: string;
    endTimeDisplay?: string;
    dateDisplay?: string;
  }>;
}

interface FlowBoardResponse {
  ok: boolean;
  date: string;
  generatedAt: string;
  barbers: FlowBoardBarber[];
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();

  return `${dayName} ${dayNum} ${monthName} ${year}`;
}

function getCairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

const BUSINESS_DAY_CUTOFF_HOUR = 4;

function isAfterMidnightShift(): boolean {
  const now = new Date();
  const cairoHour = parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(now),
    10,
  );
  return cairoHour < BUSINESS_DAY_CUTOFF_HOUR;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function readMobileBarberSelection(): MobileBarberSelection | null {
  if (typeof window === 'undefined') return null;
  const saved = sessionStorage.getItem(OPS_LAYOUT.MOBILE_BARBER_STORAGE_KEY);
  if (!saved) return null;
  if (saved === 'all') return 'all';
  const parsed = Number(saved);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function OperationsPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getCairoBusinessDate());
  const [flowBoardData, setFlowBoardData] = useState<FlowBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [showFindNearestDrawer, setShowFindNearestDrawer] = useState(false);
  const [showBookingDrawer, setShowBookingDrawer] = useState(false);
  const [settlingExpired, setSettlingExpired] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [bookingInitialData, setBookingInitialData] = useState<{
    date?: string;
    time?: string;
    empId?: number;
    barberName?: string;
    timeRangeStart?: string;
    timeRangeEnd?: string;
  }>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [musicPlayerExpanded, setMusicPlayerExpanded] = useState(false);
  const [mobileBarberSelection, setMobileBarberSelection] = useState<MobileBarberSelection>('all');
  const [quickQueueLoading, setQuickQueueLoading] = useState(false);
  const [quickQueueReprintTicket, setQuickQueueReprintTicket] = useState<CreateQueueResponse | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const quickQueuePendingRef = useRef(false);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    setVoiceEnabled(isVoiceEnabled());
    const saved = readMobileBarberSelection();
    if (saved !== null) setMobileBarberSelection(saved);
  }, []);

  useEffect(() => {
    document.title = '💈 لوحة التشغيل - الصالون';
  }, []);

  const { reannounce } = useAutoVoiceAnnounce({
    date: selectedDate,
    enabled: voiceEnabled,
    pollIntervalMs: 10000,
    onAnnouncementStart: (announcement) => {
      showToast(`نداء: ${announcement.ticketCode}`, true);
    },
    onError: () => {},
  });

  const handleEnableVoice = useCallback(() => {
    const success = enableVoice();
    if (success) {
      setVoiceEnabled(true);
      showToast('تم تفعيل النداء الصوتي', true);
    } else {
      showToast('فشل تفعيل النداء الصوتي - تأكد من دعم المتصفح', false);
    }
  }, [showToast]);

  const handleDisableVoice = useCallback(() => {
    disableVoice();
    setVoiceEnabled(false);
    showToast('تم إيقاف النداء الصوتي', true);
  }, [showToast]);

  const fetchFlowBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/operations/flow-board?date=${selectedDate}`);
      const data: FlowBoardResponse = await res.json();

      if (!data.ok) {
        throw new Error('فشل تحميل البيانات');
      }

      setFlowBoardData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحميل لوحة التشغيل');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const handleQuickQueueReprint = useCallback(() => {
    if (!quickQueueReprintTicket) return;
    const printed = printQueueTicket(createQueueResponseToPrintData(quickQueueReprintTicket));
    if (printed) {
      setQuickQueueReprintTicket(null);
      showToast('تمت إعادة الطباعة', true);
    } else {
      showToast('تعذرت إعادة الطباعة — تحقق من إعدادات المتصفح', false);
    }
  }, [quickQueueReprintTicket, showToast]);

  const handleQuickQueue = useCallback(async () => {
    if (quickQueuePendingRef.current) return;

    quickQueuePendingRef.current = true;
    setQuickQueueLoading(true);
    setQuickQueueReprintTicket(null);

    const printWin = window.open('', '_blank', 'width=300,height=400');

    try {
      const res = await fetch('/api/operations/queue/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = (await res.json()) as CreateQueueResponse | { ok: false; error?: string };

      if (!res.ok || !('ticketCode' in result)) {
        printWin?.close();
        const message =
          'error' in result && result.error
            ? result.error
            : res.status === 409
              ? 'تعذر إنشاء الدور لأن الفترة تتداخل مع حجز أو دور موجود'
              : 'تعذر إنشاء الدور السريع، حاول مرة أخرى';
        showToast(message, false);
        return;
      }

      void fetchFlowBoard();

      const printData = createQueueResponseToPrintData(result);
      const printed = printQueueTicketInWindow(printWin, printData);

      if (!printed) {
        setQuickQueueReprintTicket(result);
        showToast('تم إنشاء الدور، لكن تعذرت الطباعة', false);
      } else {
        showToast(formatQuickQueueSuccessToast(result), true);
      }
    } catch {
      printWin?.close();
      showToast('تعذر إنشاء الدور السريع، حاول مرة أخرى', false);
    } finally {
      quickQueuePendingRef.current = false;
      setQuickQueueLoading(false);
    }
  }, [fetchFlowBoard, showToast]);

  useEffect(() => {
    fetchFlowBoard();
    refreshTimer.current = setInterval(fetchFlowBoard, 30000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchFlowBoard]);

  useEffect(() => {
    const barbers = flowBoardData?.barbers.filter((b) => b.status !== 'unknown') ?? [];
    if (barbers.length === 0) return;

    const saved = sessionStorage.getItem(OPS_LAYOUT.MOBILE_BARBER_STORAGE_KEY);
    if (saved === null) {
      setMobileBarberSelection(barbers[0].empId);
      return;
    }

    setMobileBarberSelection((current) => {
      if (saved === 'all') return 'all';
      const parsed = Number(saved);
      if (Number.isFinite(parsed) && barbers.some((b) => b.empId === parsed)) {
        return parsed;
      }
      if (current !== 'all' && barbers.some((b) => b.empId === current)) return current;
      return barbers[0].empId;
    });
  }, [flowBoardData]);

  const handleMobileBarberSelect = useCallback((value: MobileBarberSelection) => {
    setMobileBarberSelection(value);
    sessionStorage.setItem(OPS_LAYOUT.MOBILE_BARBER_STORAGE_KEY, String(value));
  }, []);

  const handleSettleExpired = useCallback(async () => {
    if (settlingExpired) return;

    const confirmed = window.confirm(
      'هل تريد تسوية الأدوار المنتهية لهذا اليوم؟\n\nسيتم التعامل فقط مع الأدوار التي انتهى وقتها وتحتاج إجراء.',
    );

    if (!confirmed) return;

    setSettlingExpired(true);

    try {
      const res = await fetch('/api/queue/settle-expired', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      });

      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || 'فشل تسوية الأدوار المنتهية');
      }

      showToast(
        `تمت تسوية الأدوار المنتهية بنجاح${typeof data.settled === 'number' ? ` (${data.settled})` : ''}`,
        true,
      );

      await fetchFlowBoard();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'فشل تسوية الأدوار المنتهية', false);
    } finally {
      setSettlingExpired(false);
    }
  }, [settlingExpired, selectedDate, fetchFlowBoard, showToast]);

  const handlePrevDay = useCallback(() => {
    setSelectedDate((prev) => addDays(prev, -1));
  }, []);

  const handleNextDay = useCallback(() => {
    setSelectedDate((prev) => addDays(prev, 1));
  }, []);

  const handleToday = useCallback(() => {
    setSelectedDate(getCairoBusinessDate());
  }, []);

  const handleDateSelect = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  const openCreateBooking = useCallback(
    (initial: typeof bookingInitialData = { date: selectedDate }) => {
      setBookingInitialData(initial);
      setShowBookingDrawer(true);
    },
    [selectedDate],
  );

  const summaryStats = useCallback(() => {
    if (!flowBoardData) return { nextAvailable: null, totalWaiting: 0, totalBookings: 0 };

    const workingBarbers = flowBoardData.barbers.filter((b) => b.status === 'working');

    let nextAvailable: { name: string; time: string } | null = null;
    for (const barber of workingBarbers) {
      if (barber.nextAvailableAt) {
        const barberTime = new Date(barber.nextAvailableAt).getTime();
        const now = Date.now();
        if (barberTime >= now || barberTime - now < 60 * 60 * 1000) {
          const timeStr = new Date(barber.nextAvailableAt).toLocaleTimeString('ar-EG', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
          if (!nextAvailable) {
            nextAvailable = { name: barber.empName, time: timeStr };
          }
          break;
        }
      }
    }

    const totalWaiting = workingBarbers.reduce((sum, b) => sum + b.waitingCount, 0);
    const totalBookings = workingBarbers.reduce((sum, b) => sum + b.bookingsCount, 0);

    return { nextAvailable, totalWaiting, totalBookings };
  }, [flowBoardData]);

  const stats = summaryStats();
  const afterMidnight = isAfterMidnightShift();
  const visibleBarbers =
    flowBoardData?.barbers
      .filter((b) => b.status !== 'unknown')
      .map((b) => ({ empId: b.empId, empName: b.empName })) ?? [];

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background" dir="rtl">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-2 py-3 sm:gap-4 sm:px-4 sm:py-4 md:px-5 lg:px-6">
        <OperationsControlPanel
          date={selectedDate}
          dateLabel={formatDateLabel(selectedDate)}
          loading={loading}
          settlingExpired={settlingExpired}
          voiceEnabled={voiceEnabled}
          musicExpanded={musicPlayerExpanded}
          onPrevDay={handlePrevDay}
          onNextDay={handleNextDay}
          onToday={handleToday}
          onDateSelect={handleDateSelect}
          onRefresh={fetchFlowBoard}
          {...(QUICK_QUEUE_UI_ENABLED
            ? { onQuickQueue: handleQuickQueue, quickQueueLoading }
            : {})}
          onCreateQueue={() => setShowCreateDrawer(true)}
          onFindNearestQueue={() => setShowFindNearestDrawer(true)}
          onCreateBooking={() => openCreateBooking({ date: selectedDate })}
          onScheduleControl={() => setShowScheduleModal(true)}
          onSettleExpired={handleSettleExpired}
          onEnableVoice={handleEnableVoice}
          onDisableVoice={handleDisableVoice}
          onToggleMusic={() => setMusicPlayerExpanded((prev) => !prev)}
        />

        {quickQueueReprintTicket && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">
              تم إنشاء الدور {quickQueueReprintTicket.ticketCode}، لكن تعذرت الطباعة
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleQuickQueueReprint}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                إعادة الطباعة
              </button>
              <button
                type="button"
                onClick={() => setQuickQueueReprintTicket(null)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-muted"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}

        {afterMidnight && selectedDate === getCairoBusinessDate() && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent-foreground">
            <span>🌙</span>
            <span>وقت القاهرة بعد منتصف الليل — تعمل على يوم التشغيل السابق</span>
            <span className="opacity-60">|</span>
            <button
              type="button"
              onClick={() => setSelectedDate(getCairoToday())}
              className="text-primary underline transition-all hover:no-underline"
            >
              انتقل ليوم {formatDateLabel(getCairoToday()).split(' ').slice(0, 2).join(' ')}
            </button>
          </div>
        )}

        <BarberMobileSelector
          className="md:hidden"
          barbers={visibleBarbers}
          selected={mobileBarberSelection}
          onSelect={handleMobileBarberSelect}
        />

        <SchedulerBoard
          className="min-h-0 flex-1"
          barbers={flowBoardData?.barbers || []}
          loading={loading}
          error={error}
          onRetry={fetchFlowBoard}
          onRefresh={fetchFlowBoard}
          voiceEnabled={voiceEnabled}
          onReannounce={reannounce}
          currentDate={selectedDate}
          mobileBarberSelection={mobileBarberSelection}
          addToast={(type, message) => showToast(message, type !== 'error')}
          onEmptyCellClick={(hour, barber) => {
            const startHour = hour >= 24 ? hour - 24 : hour;
            const endHour = startHour + 1;
            const timeRangeStart = `${String(startHour).padStart(2, '0')}:00`;
            const timeRangeEnd = `${String(endHour).padStart(2, '0')}:00`;

            openCreateBooking({
              date: selectedDate,
              time: timeRangeStart,
              empId: barber.empId,
              barberName: barber.empName,
              timeRangeStart,
              timeRangeEnd,
            });
          }}
          onFreeSegmentClick={(segment, barber) => {
            const segmentStartDate = new Date(segment.start);
            const segmentEndDate = new Date(segment.end);
            const timeRangeStart = `${String(segmentStartDate.getHours()).padStart(2, '0')}:${String(segmentStartDate.getMinutes()).padStart(2, '0')}`;
            const timeRangeEnd = `${String(segmentEndDate.getHours()).padStart(2, '0')}:${String(segmentEndDate.getMinutes()).padStart(2, '0')}`;

            openCreateBooking({
              date: selectedDate,
              time: timeRangeStart,
              empId: barber.empId,
              barberName: barber.empName,
              timeRangeStart,
              timeRangeEnd,
            });
          }}
        />

        <BottomSummaryStrip
          nextAvailableBarber={stats.nextAvailable}
          totalWaiting={stats.totalWaiting}
          totalBookings={stats.totalBookings}
        />
      </div>

      <MobileOperationsActions
        onCreateQueue={() => setShowCreateDrawer(true)}
        onCreateBooking={() => openCreateBooking({ date: selectedDate })}
      />

      {showCreateDrawer && (
        <SimpleCreateQueueDrawer
          isOpen={showCreateDrawer}
          onClose={() => setShowCreateDrawer(false)}
          onCreated={() => {
            fetchFlowBoard();
            showToast('تم إنشاء الدور بنجاح');
          }}
          barbers={flowBoardData?.barbers || []}
          debugInfo={{
            source: 'flow-board',
            count: flowBoardData?.barbers?.length || 0,
            timestamp: new Date().toISOString(),
          }}
        />
      )}

      {showFindNearestDrawer && (
        <FindNearestQueueDrawer
          isOpen={showFindNearestDrawer}
          onClose={() => setShowFindNearestDrawer(false)}
          onCreated={() => {
            fetchFlowBoard();
            showToast('تم إصدار الدور بنجاح');
          }}
        />
      )}

      {showBookingDrawer && (
        <CreateBookingDrawer
          open={showBookingDrawer}
          onClose={() => setShowBookingDrawer(false)}
          initialDate={bookingInitialData.date}
          initialTime={bookingInitialData.time}
          initialEmpId={bookingInitialData.empId}
          initialBarberName={bookingInitialData.barberName}
          initialTimeRangeStart={bookingInitialData.timeRangeStart}
          initialTimeRangeEnd={bookingInitialData.timeRangeEnd}
          barbers={flowBoardData?.barbers.map((b) => ({ empId: b.empId, empName: b.empName })) || []}
          onCreated={() => {
            fetchFlowBoard();
            showToast('تم إنشاء الحجز بنجاح');
          }}
        />
      )}

      {showScheduleModal && (
        <ScheduleControlModal
          open={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          initialDate={selectedDate}
          onApplied={() => {
            fetchFlowBoard();
            showToast('تم تحديث مواعيد الصنايعي بنجاح');
          }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-xl border px-5 py-3 text-sm font-semibold shadow-2xl transition-all md:bottom-5"
          style={{
            background: toast.ok ? 'var(--card)' : 'color-mix(in srgb, var(--destructive) 15%, transparent)',
            color: toast.ok ? 'var(--foreground)' : 'var(--destructive)',
            borderColor: toast.ok
              ? 'color-mix(in srgb, var(--primary) 30%, transparent)'
              : 'color-mix(in srgb, var(--destructive) 35%, transparent)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
