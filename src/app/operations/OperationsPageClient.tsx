'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { BottomSummaryStrip } from '@/components/operations/BottomSummaryStrip';
import { OperationsControlPanel } from '@/components/operations/OperationsControlPanel';
import type {
  OpsBranchOption,
  OpsBranchScope,
  OpsPresenceFilter,
} from '@/components/operations/OperationsControlPanel';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import {
  subscribeAvailabilityChanged,
} from '@/lib/availability/availabilityChangedEvent';
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
import {
  createFlowBoardRefreshController,
  shouldRefreshBoardForBooking,
  type FlowBoardPayload,
} from '@/lib/operations/flowBoardRefreshController';
import type { BookingCreateSuccess } from '@/lib/operations/bookingWorkspaceSubmit';
import { useSession } from '@/hooks/useSession';
import {
  openBookingV2Flow,
  prefetchBookingV2Bootstrap,
  markOpsBookingUx,
} from '@/lib/operations/bookingV2';
import { shouldPlayNewBookingAlert } from '@/lib/operations/opsBoardPulse';
import { playNewBookingChime, unlockNewBookingChime } from '@/lib/operations/newBookingChime';

const boardFallback = (
  <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
    جاري تحميل اللوحة…
  </div>
);

const SchedulerBoard = dynamic(
  () => import('@/components/operations/SchedulerBoard').then((m) => ({ default: m.SchedulerBoard })),
  { ssr: false, loading: () => boardFallback },
);
const CreateBookingDrawer = dynamic(
  () => import('@/components/operations/CreateBookingDrawer').then((m) => ({ default: m.CreateBookingDrawer })),
  { ssr: false },
);
const SimpleCreateQueueDrawer = dynamic(
  () => import('@/components/operations/SimpleCreateQueueDrawer').then((m) => ({ default: m.SimpleCreateQueueDrawer })),
  { ssr: false },
);
const BarberQueueWorkspaceModal = dynamic(
  () => import('@/components/operations/BarberQueueWorkspaceModal').then((m) => ({ default: m.BarberQueueWorkspaceModal })),
  { ssr: false },
);
const FindNearestQueueDrawer = dynamic(
  () => import('@/components/operations/FindNearestQueueDrawer').then((m) => ({ default: m.FindNearestQueueDrawer })),
  { ssr: false },
);
const ScheduleControlModal = dynamic(
  () => import('@/components/operations/ScheduleControlModal').then((m) => ({ default: m.ScheduleControlModal })),
  { ssr: false },
);
const TemporaryBranchTransferModal = dynamic(
  () => import('@/components/operations/TemporaryBranchTransferModal').then((m) => ({ default: m.TemporaryBranchTransferModal })),
  { ssr: false },
);
const AffectedBookingsDrawer = dynamic(
  () => import('@/components/operations/AffectedBookingsDrawer').then((m) => ({ default: m.AffectedBookingsDrawer })),
  { ssr: false },
);

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
  isEmergencyTransfer?: boolean;
  branchId?: number;
  branchCode?: string;
  branchName?: string;
  branchShortName?: string | null;
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
    originKind?: 'website' | 'user' | 'system';
    originLabel?: string;
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
  availabilityVersion?: number;
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
  const { user, activeBranch } = useSession();
  const activeBranchIdRef = useRef<number | undefined>(user?.ActiveBranchID);
  activeBranchIdRef.current = user?.ActiveBranchID;
  const [selectedDate, setSelectedDate] = useState<string>(getCairoBusinessDate());
  const [flowBoardData, setFlowBoardData] = useState<FlowBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branchScope, setBranchScope] = useState<OpsBranchScope>('active');
  const [presenceFilter, setPresenceFilter] = useState<OpsPresenceFilter>('present');
  const [branchOptions, setBranchOptions] = useState<OpsBranchOption[]>([]);
  const branchScopeRef = useRef<OpsBranchScope>(branchScope);
  const presenceFilterRef = useRef<OpsPresenceFilter>(presenceFilter);
  branchScopeRef.current = branchScope;
  presenceFilterRef.current = presenceFilter;
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [barberQueueModal, setBarberQueueModal] = useState<{
    empId: number;
    empName: string;
    branchId?: number;
  } | null>(null);
  const [barberQueueLoadingEmpId, setBarberQueueLoadingEmpId] = useState<number | null>(null);
  const [showFindNearestDrawer, setShowFindNearestDrawer] = useState(false);
  const [showBookingDrawer, setShowBookingDrawer] = useState(false);
  const [settlingExpired, setSettlingExpired] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showTemporaryTransferModal, setShowTemporaryTransferModal] = useState(false);
  const [showAffectedBookings, setShowAffectedBookings] = useState(false);
  const [affectedBookingsCount, setAffectedBookingsCount] = useState(0);
  const [bookingInitialData, setBookingInitialData] = useState<{
    date?: string;
    time?: string;
    empId?: number;
    barberName?: string;
    timeRangeStart?: string;
    timeRangeEnd?: string;
    branchId?: number;
  }>({});
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [jumpToBookingDate, setJumpToBookingDate] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [musicPlayerExpanded, setMusicPlayerExpanded] = useState(false);
  const [publicBookingEnabled, setPublicBookingEnabled] = useState(true);
  const [publicBookingToggleLoading, setPublicBookingToggleLoading] = useState(false);
  const [mobileBarberSelection, setMobileBarberSelection] = useState<MobileBarberSelection>('all');
  const [quickQueueLoading, setQuickQueueLoading] = useState(false);
  const [quickQueueReprintTicket, setQuickQueueReprintTicket] = useState<CreateQueueResponse | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const quickQueuePendingRef = useRef(false);
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Booking V2 O1 — prefetch bootstrap on /operations entry (not on modal open).
  useEffect(() => {
    void prefetchBookingV2Bootstrap();
  }, []);

  const refreshControllerRef = useRef(
    createFlowBoardRefreshController({
      getSelectedDate: () => selectedDateRef.current,
      getBranchId: () => {
        const scope = branchScopeRef.current;
        const presence = presenceFilterRef.current;
        const scopeKey = scope === 'all' || scope === 'active' ? scope : `b${scope}`;
        return `${scopeKey}:${presence}:${activeBranchIdRef.current ?? '_'}`;
      },
      fetchBoard: async (date, signal) => {
        const t0 = performance.now();
        const scope = branchScopeRef.current;
        const presence = presenceFilterRef.current;
        const branchIdParam =
          scope === 'all' || scope === 'active' ? scope : String(scope);
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ops-booking-perf] flow_board_refresh_start', {
            date,
            branchId: branchIdParam,
            presence,
          });
        }
        const qs = new URLSearchParams({
          date,
          branchId: branchIdParam,
          presence,
        });
        const res = await fetch(`/api/operations/flow-board?${qs}`, { signal });
        const data = (await res.json()) as FlowBoardPayload;
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ops-booking-perf] flow_board_refresh_done', {
            date,
            ms: Math.round(performance.now() - t0),
            status: res.status,
            ok: !!data.ok,
          });
        }
        return data;
      },
      onData: (data) => {
        setFlowBoardData(data as FlowBoardResponse);
      },
      onLoading: setLoading,
      onError: setError,
    }),
  );

  const refreshFlowBoard = useCallback(
    (date: string, options?: { reason?: string; force?: boolean; silent?: boolean }) =>
      refreshControllerRef.current.refreshFlowBoard(date, options),
    [],
  );

  /** Convenience: refresh the currently selected board date. */
  const fetchFlowBoard = useCallback(
    (options?: { reason?: string; force?: boolean; silent?: boolean }) =>
      refreshFlowBoard(selectedDateRef.current, options),
    [refreshFlowBoard],
  );

  useEffect(() => {
    const unlock = () => unlockNewBookingChime();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    document.title = '💈 لوحة التشغيل - الصالون';
  }, []);

  useEffect(() => {
    return subscribeAvailabilityChanged((detail) => {
      if (detail.businessDate !== selectedDate) return;
      void fetchFlowBoard({ reason: 'schedule-applied' });
    });
  }, [selectedDate, fetchFlowBoard]);

  // Cheap pulse: refresh the heavy board only when bookings/queue/availability actually change.
  useEffect(() => {
    let cancelled = false;
    let fingerprint: string | null = null;
    let maxBookingId: number | null = null;

    const pulse = async () => {
      try {
        const scope = branchScopeRef.current;
        const presence = presenceFilterRef.current;
        const branchIdParam =
          scope === 'all' || scope === 'active' ? scope : String(scope);
        const qs = new URLSearchParams({
          date: selectedDateRef.current,
          branchId: branchIdParam,
          presence,
        });
        const res = await fetch(`/api/operations/flow-board/pulse?${qs}`);
        const data = (await res.json()) as {
          ok?: boolean;
          fingerprint?: string;
          maxBookingId?: number;
        };
        if (cancelled || !data.ok || !data.fingerprint) return;

        const nextMax = data.maxBookingId ?? 0;
        if (shouldPlayNewBookingAlert(maxBookingId, nextMax)) {
          playNewBookingChime();
          showToast('حجز جديد وصل');
        }
        maxBookingId = nextMax;

        if (fingerprint === data.fingerprint) return;
        const isFirstSample = fingerprint === null;
        fingerprint = data.fingerprint;
        if (isFirstSample) return;
        void fetchFlowBoard({ reason: 'pulse', silent: true });
      } catch {
        /* ignore pulse errors */
      }
    };

    const id = window.setInterval(() => void pulse(), 5_000);
    void pulse();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedDate, branchScope, presenceFilter, fetchFlowBoard, showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/branches/available');
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const rows = Array.isArray(data.branches) ? data.branches : [];
        setBranchOptions(
          rows.map((b: {
            BranchID: number;
            BranchCode: string;
            BranchName: string;
            ShortName?: string | null;
          }) => ({
            branchId: b.BranchID,
            branchCode: b.BranchCode,
            branchName: b.BranchName,
            shortName: b.ShortName ?? null,
          })),
        );
      } catch {
        // keep empty — filter still works with "active"
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.ActiveBranchID]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/booking-settings');
        const data = await res.json();
        if (!cancelled && data?.ok && data.settings) {
          setPublicBookingEnabled(!!data.settings.bookingEnabled);
        }
      } catch {
        // Keep default enabled until user can toggle
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.ActiveBranchID]);

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

  const handleTogglePublicBooking = useCallback(async () => {
    if (publicBookingToggleLoading) return;
    const next = !publicBookingEnabled;
    setPublicBookingToggleLoading(true);
    setPublicBookingEnabled(next);
    try {
      const res = await fetch('/api/admin/booking-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingEnabled: next }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setPublicBookingEnabled(!next);
        showToast(data?.error || 'فشل تحديث إعداد حجز الموقع', false);
        return;
      }
      if (typeof data.bookingEnabled === 'boolean') {
        setPublicBookingEnabled(data.bookingEnabled);
      }
      showToast(
        next
          ? 'تم تفعيل حجز الموقع'
          : 'تم إيقاف حجز الموقع — الموقع يعرض «الحجز غير متاح اليوم»',
        true,
      );
    } catch {
      setPublicBookingEnabled(!next);
      showToast('فشل تحديث إعداد حجز الموقع', false);
    } finally {
      setPublicBookingToggleLoading(false);
    }
  }, [publicBookingEnabled, publicBookingToggleLoading, showToast]);

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
    void refreshFlowBoard(selectedDate, { reason: 'date-or-filters', force: true });
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(() => {
      void refreshFlowBoard(selectedDateRef.current, { reason: 'poll', silent: true });
    }, 60_000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [selectedDate, branchScope, presenceFilter, refreshFlowBoard]);

  useEffect(() => {
    let cancelled = false;
    const loadCount = async () => {
      try {
        const sp = new URLSearchParams({
          date: selectedDate,
          unresolved: '1',
        });
        const res = await fetch(`/api/operations/affected-bookings?${sp}`, {
          credentials: 'include',
        });
        const data = (await res.json()) as { ok?: boolean; bookings?: unknown[] };
        if (!cancelled && data.ok) {
          setAffectedBookingsCount(data.bookings?.length ?? 0);
        }
      } catch {
        /* non-critical badge */
      }
    };
    void loadCount();
    const t = setInterval(() => void loadCount(), 60000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selectedDate, showAffectedBookings]);

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
      markOpsBookingUx('add_click', {
        empId: initial.empId ?? null,
        date: initial.date ?? selectedDate,
      });
      setBookingInitialData(initial);
      setShowBookingDrawer(true);
      // Prefetch 14-day matrix early (non-blocking — modal already open).
      const branchCode =
        user?.ActiveBranchCode
        ?? activeBranch?.branchCode
        ?? null;
      void openBookingV2Flow({
        mode: initial.empId ? 'specific' : 'nearest',
        employeeId: initial.empId ?? null,
        branchCode,
        businessDate: initial.date ?? selectedDate,
      });
    },
    [selectedDate, user?.ActiveBranchCode, activeBranch?.branchCode],
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
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden px-1 py-1 md:gap-4 md:px-4 md:py-4 lg:px-6">
        <OperationsControlPanel
          date={selectedDate}
          dateLabel={formatDateLabel(selectedDate)}
          loading={loading}
          settlingExpired={settlingExpired}
          voiceEnabled={voiceEnabled}
          musicExpanded={musicPlayerExpanded}
          publicBookingEnabled={publicBookingEnabled}
          publicBookingToggleLoading={publicBookingToggleLoading}
          branchScope={branchScope}
          presenceFilter={presenceFilter}
          branchOptions={branchOptions}
          activeBranchLabel={
            activeBranch?.shortName || activeBranch?.branchName || user?.ActiveBranchCode
          }
          onBranchScopeChange={setBranchScope}
          onPresenceFilterChange={setPresenceFilter}
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
          onTemporaryTransfer={() => setShowTemporaryTransferModal(true)}
          onAffectedBookings={() => setShowAffectedBookings(true)}
          affectedBookingsCount={affectedBookingsCount}
          onSettleExpired={handleSettleExpired}
          onEnableVoice={handleEnableVoice}
          onDisableVoice={handleDisableVoice}
          onToggleMusic={() => setMusicPlayerExpanded((prev) => !prev)}
          onTogglePublicBooking={handleTogglePublicBooking}
        />

        {quickQueueReprintTicket && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 rounded-md border border-warning/30 bg-warning/10 px-1.5 py-1 text-[10px] md:gap-2 md:rounded-xl md:px-3 md:py-2 md:text-sm">
            <span className="font-medium text-foreground">
              تم إنشاء الدور {quickQueueReprintTicket.ticketCode}، لكن تعذرت الطباعة
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleQuickQueueReprint}
                className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 md:rounded-lg md:px-3 md:py-1.5 md:text-sm"
              >
                إعادة الطباعة
              </button>
              <button
                type="button"
                onClick={() => setQuickQueueReprintTicket(null)}
                className="rounded-md px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-surface-muted md:rounded-lg md:px-3 md:py-1.5 md:text-sm"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}

        {afterMidnight && selectedDate === getCairoBusinessDate() && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent-foreground md:gap-2 md:rounded-xl md:px-3 md:py-2 md:text-xs">
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
              branchId: barber.branchId,
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
              branchId: barber.branchId,
            });
          }}
          onBarberQueueClick={(barber) => {
            setBarberQueueModal({
              empId: barber.empId,
              empName: barber.empName,
              branchId: barber.branchId,
            });
          }}
          barberQueueLoadingEmpId={barberQueueLoadingEmpId}
          barberQueueSourceEmpId={barberQueueModal?.empId ?? null}
          canCreateQueue
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

      {barberQueueModal && (
        <BarberQueueWorkspaceModal
          open={!!barberQueueModal}
          barber={barberQueueModal}
          operationalDate={selectedDate}
          requestedFrom={new Date().toISOString()}
          onClose={() => setBarberQueueModal(null)}
          onCreated={() => {
            void fetchFlowBoard({ reason: 'queue-created' });
            showToast('تم إنشاء الدور بنجاح');
          }}
          onLoadingChange={setBarberQueueLoadingEmpId}
        />
      )}

      {showCreateDrawer && (
        <SimpleCreateQueueDrawer
          isOpen={showCreateDrawer}
          onClose={() => setShowCreateDrawer(false)}
          onCreated={() => {
            void fetchFlowBoard({ reason: 'queue-created' });
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
            void fetchFlowBoard({ reason: 'queue-created' });
            showToast('تم إصدار الدور بنجاح');
          }}
        />
      )}

      {showBookingDrawer && (
        <CreateBookingDrawer
          open={showBookingDrawer}
          onClose={() => setShowBookingDrawer(false)}
          initialDate={bookingInitialData.date}
          boardDate={selectedDate}
          initialEmpId={bookingInitialData.empId}
          initialBarberName={bookingInitialData.barberName}
          initialTimeRangeStart={bookingInitialData.timeRangeStart}
          initialTimeRangeEnd={bookingInitialData.timeRangeEnd}
          initialBranchId={bookingInitialData.branchId}
          barbers={flowBoardData?.barbers.map((b) => ({
            empId: b.empId,
            empName: b.empName,
            status: b.status,
            workStart: b.workStart,
            workEnd: b.workEnd,
            nextAvailableAt: b.nextAvailableAt,
            statusReasonArabic: b.statusReasonArabic,
            branchId: b.branchId,
          })) || []}
          onCreated={(result?: BookingCreateSuccess) => {
            showToast('تم إنشاء الحجز بنجاح');
            playNewBookingChime();
            const bookedDate = result?.actualDate;
            if (shouldRefreshBoardForBooking(selectedDateRef.current, bookedDate)) {
              void refreshFlowBoard(selectedDateRef.current, { reason: 'booking-created' }).catch(
                () => {
                  showToast(
                    'تم إنشاء الحجز، لكن تعذر تحديث اللوحة. اضغط لإعادة المحاولة.',
                    false,
                  );
                },
              );
            } else if (bookedDate) {
              setJumpToBookingDate(bookedDate);
            }
          }}
        />
      )}

      {showScheduleModal && (
        <ScheduleControlModal
          open={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          initialDate={selectedDate}
          onApplied={() => {
            void fetchFlowBoard({ reason: 'schedule-applied' });
            showToast('تم تحديث مواعيد الصنايعي بنجاح');
          }}
        />
      )}

      <TemporaryBranchTransferModal
        open={showTemporaryTransferModal}
        onClose={() => setShowTemporaryTransferModal(false)}
        workDate={selectedDate}
        onTransferred={() => {
          void fetchFlowBoard({ reason: 'temporary-transfer' });
          showToast('تم نقل الموظف لفرع آخر لهذا اليوم');
        }}
      />

      <AffectedBookingsDrawer
        isOpen={showAffectedBookings}
        onClose={() => setShowAffectedBookings(false)}
        businessDate={selectedDate}
        onMoved={() => {
          void fetchFlowBoard({ reason: 'affected-booking-moved' });
          showToast('تم تحديث الحجز المتأثر');
        }}
      />

      {jumpToBookingDate && (
        <button
          type="button"
          className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-3 py-1.5 text-[11px] font-semibold shadow-2xl md:bottom-16 md:rounded-xl md:px-5 md:py-3 md:text-sm"
          style={{
            background: 'var(--card)',
            color: 'var(--foreground)',
            borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
          }}
          onClick={() => {
            const d = jumpToBookingDate;
            setJumpToBookingDate(null);
            setSelectedDate(d);
          }}
        >
          عرض يوم الحجز ({jumpToBookingDate})
        </button>
      )}

      {toast && (
        <div
          className="fixed bottom-12 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-3 py-1.5 text-[11px] font-semibold shadow-2xl transition-all md:bottom-5 md:rounded-xl md:px-5 md:py-3 md:text-sm"
          style={{
            background: toast.ok ? 'var(--card)' : 'color-mix(in srgb, var(--destructive) 15%, transparent)',
            color: toast.ok ? 'var(--foreground)' : 'var(--destructive)',
            borderColor: toast.ok
              ? 'color-mix(in srgb, var(--primary) 30%, transparent)'
              : 'color-mix(in srgb, var(--destructive) 35%, transparent)',
          }}
        >
          {toast.msg}
          {!toast.ok && toast.msg.includes('تعذر تحديث اللوحة') && (
            <button
              type="button"
              className="mr-3 underline"
              onClick={() => {
                void fetchFlowBoard({ reason: 'retry', force: true });
              }}
            >
              إعادة المحاولة
            </button>
          )}
        </div>
      )}
    </div>
  );
}
