'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  type AvailableSlot,
  type BarberAlternative,
  type BookingClient,
  type BookingMode,
  type BookingService,
  type BookingStep,
  type BookingWorkspaceBarber,
  type GapNotice,
  formatDateLabel,
  getOperationalToday,
  getOperationalTomorrow,
  isBeforeOperationalDate,
  isSlotInsideRange,
  mapFlowBoardBarbersForBooking,
  sanitizeDate,
  stripStaleBarberDayMeta,
} from './types';
import {
  acquireSubmitGuard,
  BOOKING_SUCCESS_CLOSE_DELAY_MS,
  extractBookingCreateErrorMessage,
  parseBookingCreateSuccess,
  releaseSubmitGuard,
  type BookingCreateSuccess,
} from '@/lib/operations/bookingWorkspaceSubmit';
import {
  useBookingV2Store,
  setBookingV2Selection,
  prefetchBookingV2Availability,
  getEmployeeBranchCodesFromStore,
  hasCachedBranchInActiveMatrix,
  markOpsBookingUx,
  measureOpsBookingUx,
  notifyBookingV2CreateSuccess,
  notifyBookingV2SlotConflict,
  BOOKING_V2_SLOT_STALE_NOTICE_AR,
  type GeneratedStart,
} from '@/lib/operations/bookingV2';
import { traceLog, traceMatchesAvailableSlot } from '@/lib/operations/bookingV2/traceSlotDebug';
import { useSession } from '@/hooks/useSession';

export type SlotsViewState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

function generatedStartToSlot(s: GeneratedStart): AvailableSlot {
  return {
    time: s.time,
    endTime: s.endTime,
    label: s.label,
    empId: s.employeeId,
    barberName: s.barberName,
    durationMinutes: s.durationMinutes,
    dayOffset: s.dayOffset,
    startAt: s.startAt,
    endAt: s.endAt,
    available: true,
    branchCode: s.branchCode,
    businessDate: s.businessDate,
  };
}

function mapBootstrapService(s: {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  durationMinutes: number;
  categoryNameAr: string;
  categoryNameEn: string;
}): BookingService {
  return {
    ProID: s.serviceId,
    ProName: s.nameAr || s.name || s.nameEn,
    SPrice: s.price,
    DurationMinutes: s.durationMinutes,
    CatName: s.categoryNameAr || s.categoryNameEn || null,
  };
}

function slotKey(s: Pick<AvailableSlot, 'empId' | 'time' | 'dayOffset' | 'branchCode'>): string {
  return `${s.empId}|${s.branchCode ?? ''}|${s.time}|${s.dayOffset ?? 0}`;
}

export interface UseBookingWorkspaceArgs {
  open: boolean;
  initialDate?: string;
  /** Ops board selected date — barber card hours come from this snapshot until bookingDate diverges. */
  boardDate?: string;
  initialEmpId?: number;
  initialBarberName?: string;
  initialTimeRangeStart?: string;
  initialTimeRangeEnd?: string;
  /** Flow-board branch for the locked barber (cross-branch ops without session switch). */
  initialBranchId?: number;
  barbers: BookingWorkspaceBarber[];
  onClose: () => void;
  onCreated?: (result?: BookingCreateSuccess) => void;
}

export function useBookingWorkspace({
  open,
  initialDate,
  boardDate,
  initialEmpId,
  initialBarberName,
  initialTimeRangeStart,
  initialTimeRangeEnd,
  initialBranchId,
  barbers,
  onClose,
  onCreated,
}: UseBookingWorkspaceArgs) {
  const { user, activeBranch } = useSession();
  const sessionBranchCode =
    user?.ActiveBranchCode
    ?? activeBranch?.branchCode
    ?? null;
  const v2 = useBookingV2Store();

  const [step, setStep] = useState<BookingStep>(1);
  const [mode, setMode] = useState<BookingMode>(initialEmpId ? 'specific' : 'nearest');

  const [services, setServices] = useState<BookingService[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectedServices, setSelectedServices] = useState<BookingService[]>([]);

  const [bookingDate, setBookingDate] = useState(() => sanitizeDate(initialDate));
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(initialEmpId || null);
  /** Local branch filter within cached multi-branch matrix (instant). */
  const [selectedBranchCode, setSelectedBranchCode] = useState<string | null>(sessionBranchCode);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [filterByTimeRange, setFilterByTimeRange] = useState(false);
  const [gapNotice] = useState<GapNotice | null>(null);
  const [alternativeBarbers] = useState<BarberAlternative[]>([]);
  const [slotStaleNotice, setSlotStaleNotice] = useState<string | null>(null);
  const [slotsMeta, setSlotsMeta] = useState<{
    validSlotCountBeforeLimit?: number;
    returnedSlotCount?: number;
    limitApplied?: boolean;
  } | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<BookingClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<BookingClient | null>(null);
  const [showClients, setShowClients] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const barberDayAbortRef = useRef<AbortController | null>(null);
  const [dateBarbers, setDateBarbers] = useState<BookingWorkspaceBarber[] | null>(null);
  const [loadingDateBarbers, setLoadingDateBarbers] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const servicesUsableMarkedRef = useRef(false);
  const availabilityVisibleMarkedRef = useRef(false);

  const displayBarbers = dateBarbers ?? barbers;
  const branchCode = selectedBranchCode ?? sessionBranchCode;

  /** Slots from V2 matrix + local generateStartsFromFree — never from available-slots. */
  const availableSlots = useMemo(
    () => v2.generatedStarts.map(generatedStartToSlot),
    [v2.generatedStarts],
  );

  const slotsViewState: SlotsViewState = useMemo(() => {
    if (!open || selectedServices.length === 0) return 'idle';
    if (v2.availabilityStatus === 'error') return 'error';
    if (v2.availabilityStatus === 'loading' && availableSlots.length === 0) return 'loading';
    if (v2.availabilityStatus === 'ready' || availableSlots.length > 0) {
      return availableSlots.length === 0 ? 'empty' : 'ready';
    }
    if (v2.availabilityStatus === 'loading') return 'loading';
    return 'idle';
  }, [open, selectedServices.length, v2.availabilityStatus, availableSlots.length]);

  const loadingSlots = slotsViewState === 'loading';
  const slotsError =
    slotsViewState === 'error'
      ? (v2.availabilityError || 'تعذر تحميل المواعيد')
      : null;
  const availabilitySoftError =
    v2.availabilityStatus === 'ready' && v2.availabilityError
      ? v2.availabilityError
      : null;

  const displayServices = services;

  const totalDuration = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.DurationMinutes ?? 30), 0),
    [selectedServices],
  );
  const totalPrice = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.SPrice ?? 0), 0),
    [selectedServices],
  );
  const serviceIds = useMemo(() => selectedServices.map((s) => s.ProID), [selectedServices]);

  useEffect(() => {
    if (!open) return;
    traceLog('[trace-slot][useBookingWorkspace][availableSlots]', {
      employeeId: mode === 'specific' ? selectedBarberId : null,
      branchCode,
      businessDate: bookingDate,
      durationMinutes: totalDuration,
      activeMatrixKey: v2.activeMatrixKey,
      includes16_00: availableSlots.some(traceMatchesAvailableSlot),
      slotCount: availableSlots.length,
    });
  }, [
    open,
    mode,
    selectedBarberId,
    branchCode,
    bookingDate,
    totalDuration,
    v2.activeMatrixKey,
    availableSlots,
  ]);

  const employeeBranchCodes = useMemo(() => {
    if (mode !== 'specific' || !selectedBarberId) return [] as string[];
    return getEmployeeBranchCodesFromStore(selectedBarberId);
  }, [mode, selectedBarberId, v2.bootstrap?.revision]);

  const nextAvailable = availableSlots[0] ?? null;

  const selectedBarberName = useMemo(() => {
    if (mode === 'specific' && selectedBarberId) {
      return displayBarbers.find((b) => b.empId === selectedBarberId)?.empName
        ?? initialBarberName
        ?? '';
    }
    return '';
  }, [mode, selectedBarberId, displayBarbers, initialBarberName]);

  /**
   * Barber cards must reflect bookingDate, not the ops board day.
   * When dates match, reuse the board snapshot; otherwise refetch flow-board for bookingDate.
   */
  useEffect(() => {
    if (!open) {
      barberDayAbortRef.current?.abort();
      setDateBarbers(null);
      setLoadingDateBarbers(false);
      return;
    }

    if (boardDate && bookingDate === boardDate) {
      barberDayAbortRef.current?.abort();
      setDateBarbers(null);
      setLoadingDateBarbers(false);
      return;
    }

    barberDayAbortRef.current?.abort();
    const controller = new AbortController();
    barberDayAbortRef.current = controller;
    setLoadingDateBarbers(true);

    fetch(
      `/api/operations/flow-board?date=${encodeURIComponent(bookingDate)}&branchId=all&presence=all`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok || !data?.ok || !Array.isArray(data.barbers)) {
          setDateBarbers(stripStaleBarberDayMeta(barbers));
          return;
        }
        const mapped = mapFlowBoardBarbersForBooking(data.barbers);
        // Keep a locked barber visible even if presence filter differs.
        if (
          initialEmpId
          && !mapped.some((b) => b.empId === initialEmpId)
        ) {
          const locked = barbers.find((b) => b.empId === initialEmpId);
          if (locked) {
            mapped.unshift(...stripStaleBarberDayMeta([locked]));
          }
        }
        setDateBarbers(mapped);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setDateBarbers(stripStaleBarberDayMeta(barbers));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDateBarbers(false);
      });

    return () => controller.abort();
  }, [open, bookingDate, boardDate, barbers, initialEmpId]);

  const hasTimeRange = !!initialTimeRangeStart && !!initialTimeRangeEnd;
  const isDatePast = isBeforeOperationalDate(bookingDate);
  const isToday = bookingDate === getOperationalToday();
  const isTomorrow = bookingDate === getOperationalTomorrow();
  const lockedBarber = !!initialEmpId;

  const filteredSlots = useMemo(() => {
    if (!hasTimeRange || !filterByTimeRange) return availableSlots;
    return availableSlots.filter((s) =>
      isSlotInsideRange(s, initialTimeRangeStart!, initialTimeRangeEnd!, bookingDate),
    );
  }, [availableSlots, hasTimeRange, filterByTimeRange, initialTimeRangeStart, initialTimeRangeEnd, bookingDate]);

  const preferredRangeSlots = useMemo(() => {
    if (!hasTimeRange) return [];
    return availableSlots.filter((s) =>
      isSlotInsideRange(s, initialTimeRangeStart!, initialTimeRangeEnd!, bookingDate),
    );
  }, [availableSlots, hasTimeRange, initialTimeRangeStart, initialTimeRangeEnd, bookingDate]);

  const displaySlots = useMemo(() => {
    if (filterByTimeRange || !hasTimeRange) return filteredSlots;
    const inRange = new Set(preferredRangeSlots.map((s) => `${s.empId}-${s.time}-${s.dayOffset ?? 0}`));
    const preferred = preferredRangeSlots;
    const rest = filteredSlots.filter((s) => !inRange.has(`${s.empId}-${s.time}-${s.dayOffset ?? 0}`));
    return [...preferred, ...rest];
  }, [filterByTimeRange, hasTimeRange, preferredRangeSlots, filteredSlots]);

  const invalidateSlotSelection = useCallback(() => {
    setSelectedSlot(null);
    setSlotStaleNotice(null);
    setSlotsMeta(null);
  }, []);

  const beginSlotRefresh = useCallback(() => {
    invalidateSlotSelection();
  }, [invalidateSlotSelection]);

  const resetWorkspace = useCallback(() => {
    setFilterByTimeRange(false);
    setSelectedSlot(null);
    setSelectedServices([]);
    setSelectedClient(null);
    setCustomerName('');
    setCustomerPhone('');
    setNotes('');
    setClientSearch('');
    setError(null);
    setSlotStaleNotice(null);
    setSlotsMeta(null);
    setStep(1);
    setSuccess(false);
    setMode(initialEmpId ? 'specific' : 'nearest');
    setSelectedBarberId(initialEmpId || null);
    setSelectedBranchCode(sessionBranchCode);
    setBookingDate(sanitizeDate(initialDate));
    setShowDatePicker(false);
    servicesUsableMarkedRef.current = false;
    availabilityVisibleMarkedRef.current = false;
  }, [initialDate, initialEmpId, sessionBranchCode]);

  // Catalog from prefetched V2 bootstrap only — never blocks modal open.
  // Fallback /api/services only if bootstrap failed (not on every open).
  useEffect(() => {
    if (v2.bootstrap && branchCode) {
      const list = v2.bootstrap.servicesByBranch[branchCode] ?? [];
      setServices(list.map(mapBootstrapService));
      setLoadingServices(false);
      return;
    }
    if (v2.bootstrapStatus === 'loading' || v2.bootstrapStatus === 'idle') {
      // Shell stays interactive; services step shows skeleton.
      setLoadingServices(true);
      return;
    }
    if (v2.bootstrapStatus !== 'error') return;

    let cancelled = false;
    setLoadingServices(true);
    fetch('/api/services?active=true&bookable=true')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const raw: BookingService[] = d.services ?? (Array.isArray(d) ? d : []);
        setServices(
          raw
            .filter((s) => !s.isDeleted)
            .map((s) => ({
              ...s,
              SPrice: s.SPrice ?? s.SPrice1 ?? 0,
            })),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingServices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [v2.bootstrap, v2.bootstrapStatus, branchCode]);

  // Duration comes from bootstrap catalog — no resolve-durations waterfall.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    resetWorkspace();
    markOpsBookingUx('modal_visible');
    measureOpsBookingUx('click_to_modal', 'add_click', 'modal_visible');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || loadingServices || services.length === 0) return;
    if (servicesUsableMarkedRef.current) return;
    servicesUsableMarkedRef.current = true;
    markOpsBookingUx('services_usable', { count: services.length });
    measureOpsBookingUx('modal_to_services', 'modal_visible', 'services_usable');
  }, [open, loadingServices, services.length]);

  // Local selection sync — service/date/duration never trigger availability HTTP.
  useEffect(() => {
    if (!open) return;
    setBookingV2Selection({
      mode,
      employeeId: mode === 'specific' ? selectedBarberId : null,
      branchCode,
      businessDate: bookingDate,
      serviceIds,
      durationMinutes: totalDuration,
    });
  }, [
    open,
    mode,
    selectedBarberId,
    branchCode,
    bookingDate,
    serviceIds,
    totalDuration,
  ]);

  // Prefetch matrix only when scope changes (emp / nearest / branch roster identity).
  useEffect(() => {
    if (!open) return;
    void prefetchBookingV2Availability({
      mode,
      employeeId: mode === 'specific' ? selectedBarberId : null,
      branchCode: sessionBranchCode,
    });
  }, [
    open,
    mode,
    selectedBarberId,
    sessionBranchCode,
    v2.bootstrap?.revision,
  ]);

  useEffect(() => {
    if (!open || selectedServices.length === 0) return;
    if (slotsViewState === 'ready' && !availabilityVisibleMarkedRef.current) {
      availabilityVisibleMarkedRef.current = true;
      markOpsBookingUx('availability_visible', { slots: availableSlots.length });
      measureOpsBookingUx(
        'barber_to_availability',
        'modal_visible',
        'availability_visible',
      );
    }
    if (slotsViewState === 'ready' || slotsViewState === 'empty') {
      setSlotsMeta({
        validSlotCountBeforeLimit: availableSlots.length,
        returnedSlotCount: availableSlots.length,
        limitApplied: false,
      });
    }
  }, [open, selectedServices.length, slotsViewState, availableSlots.length]);

  // Stale revision / soft refresh: keep modal; clear only vanished selected slot.
  useEffect(() => {
    if (!open || !selectedSlot) return;
    if (v2.availabilityStatus !== 'ready' && !v2.availabilityRevalidating) return;
    const stillThere = availableSlots.some((s) => slotKey(s) === slotKey(selectedSlot));
    if (!stillThere) {
      setSelectedSlot(null);
      setSlotStaleNotice(BOOKING_V2_SLOT_STALE_NOTICE_AR);
    }
  }, [
    open,
    selectedSlot,
    availableSlots,
    v2.availabilityStatus,
    v2.availabilityRevalidating,
  ]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  useEffect(() => {
    if (!open && returnFocusRef.current) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (clientSearch.length < 2) { setClients([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`)
        .then((r) => r.json())
        .then((d) => { setClients(Array.isArray(d) ? d : (d.clients ?? d.data ?? [])); setShowClients(true); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  /** Targeted day refresh after write conflicts — no full 14-day reload. */
  const fetchSlots = useCallback(async () => {
    if (!selectedSlot && !selectedBarberId) return;
    const empId = selectedSlot?.empId ?? selectedBarberId;
    if (!empId) return;
    notifyBookingV2SlotConflict({
      employeeId: empId,
      businessDate: selectedSlot?.businessDate ?? bookingDate,
      branchCode: selectedSlot?.branchCode ?? branchCode ?? undefined,
    });
  }, [selectedSlot, selectedBarberId, bookingDate, branchCode]);

  const retryAvailability = useCallback(() => {
    void prefetchBookingV2Availability({
      mode,
      employeeId: mode === 'specific' ? selectedBarberId : null,
      branchCode: sessionBranchCode,
      force: true,
    });
  }, [mode, selectedBarberId, sessionBranchCode]);

  const handleDateChange = (newDate: string) => {
    const t0 = performance.now();
    setBookingDate(sanitizeDate(newDate));
    invalidateSlotSelection();
    setFilterByTimeRange(false);
    setShowDatePicker(false);
    setError(null);
    markOpsBookingUx('date_change_local', {
      ms: Math.round(performance.now() - t0),
    });
  };

  const handleBranchChange = useCallback((code: string) => {
    const t0 = performance.now();
    const next = code.toUpperCase();
    setSelectedBranchCode(next);
    invalidateSlotSelection();
    setError(null);
    markOpsBookingUx('branch_change_local', {
      branch: next,
      cached: hasCachedBranchInActiveMatrix(next),
      ms: Math.round(performance.now() - t0),
    });
    // Cached multi-branch matrix → setBookingV2Selection filters locally (no HTTP).
  }, [invalidateSlotSelection]);

  const handleModeChange = (next: BookingMode) => {
    setMode(next);
    if (next === 'specific') {
      setSelectedBarberId(initialEmpId || selectedBarberId || null);
    }
    invalidateSlotSelection();
  };

  const MAIN_SERVICE_NAMES = useMemo(
    () => [
      'Hair Cut', 'Haircut', 'Basic Cut', 'Detailed Cut', 'Detail Cut', 'DetailedCut',
      'Beard Styling & Fade', 'Beard Styling', 'Beard',
      'Haircut & Beard', 'Hair & Beard', 'Hair cut & Beard', 'Hair cut + Beard', 'Hair and Beard',
      'Advanced Cut', 'Fade Cut',
    ],
    [],
  );

  const isMainService = useCallback((name: string) => {
    const norm = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ').replace(/[&+]/g, ' and ');
    return MAIN_SERVICE_NAMES.some((mn) => {
      const nmn = mn.toLowerCase().replace(/[\s_-]+/g, ' ').replace(/[&+]/g, ' and ');
      return norm === nmn || norm.includes(nmn) || nmn.includes(norm);
    });
  }, [MAIN_SERVICE_NAMES]);

  const handleMainSelect = useCallback((proId: number) => {
    const t0 = performance.now();
    const svc = displayServices.find((s) => s.ProID === proId);
    if (!svc) return;
    setSelectedServices((prev) => {
      const alreadyMain = prev.some((s) => s.ProID === proId && isMainService(s.ProName));
      const addons = prev.filter((s) => !isMainService(s.ProName));
      if (alreadyMain) return addons;
      return [svc, ...addons];
    });
    invalidateSlotSelection();
    markOpsBookingUx('service_change_local', {
      ms: Math.round(performance.now() - t0),
    });
  }, [displayServices, isMainService, invalidateSlotSelection]);

  const handleToggleAddon = useCallback((proId: number) => {
    const t0 = performance.now();
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.ProID === proId);
      if (exists) return prev.filter((s) => s.ProID !== proId);
      const svc = displayServices.find((s) => s.ProID === proId);
      return svc ? [...prev, svc] : prev;
    });
    invalidateSlotSelection();
    markOpsBookingUx('service_change_local', {
      ms: Math.round(performance.now() - t0),
    });
  }, [displayServices, invalidateSlotSelection]);

  const removeService = useCallback((proId: number) => {
    setSelectedServices((prev) => prev.filter((s) => s.ProID !== proId));
    invalidateSlotSelection();
  }, [invalidateSlotSelection]);

  const handleSubmit = async () => {
    if (!selectedSlot || !selectedServices.length) return;
    if (!acquireSubmitGuard(submittingRef)) return;
    if (selectedSlot.durationMinutes !== totalDuration) {
      releaseSubmitGuard(submittingRef);
      setError(`الموعد المختار لا يطابق المدة المطلوبة (${totalDuration} دقيقة)`);
      beginSlotRefresh();
      setStep(3);
      return;
    }
    setError(null);
    const submitT0 = performance.now();
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ops-booking-perf] confirm_click', { t: 0 });
    }
    setSubmitting(true);
    try {
      const targetBranchId =
        (selectedSlot.empId
          ? barbers.find((b) => b.empId === selectedSlot.empId)?.branchId
          : null) ??
        initialBranchId ??
        null;
      const payload = {
        customer: {
          name: selectedClient?.Name || customerName,
          phone: selectedClient?.Mobile || customerPhone.trim() || '',
        },
        serviceIds,
        date: bookingDate,
        time: selectedSlot.time,
        dayOffset: selectedSlot.dayOffset ?? 0,
        mode: mode === 'specific' ? 'specific' : 'nearest',
        empId: selectedSlot.empId,
        notes: notes.trim(),
        source: 'operations',
        ...(targetBranchId != null ? { branchId: targetBranchId } : {}),
      };
      if (process.env.NODE_ENV !== 'production') {
        console.log('[ops-booking-perf] post_start', {
          msSinceConfirm: Math.round(performance.now() - submitT0),
          date: bookingDate,
          dayOffset: selectedSlot.dayOffset ?? 0,
          empId: selectedSlot.empId,
        });
      }
      const res = await fetch('/api/public/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[ops-booking-perf] post_return', {
          msSinceConfirm: Math.round(performance.now() - submitT0),
          status: res.status,
          ok: !!(data && data.ok),
          bookingId: data?.booking?.id ?? null,
        });
      }
      if (res.status === 409) {
        setError(
          extractBookingCreateErrorMessage(
            data,
            BOOKING_V2_SLOT_STALE_NOTICE_AR,
          ),
        );
        notifyBookingV2SlotConflict({
          employeeId: selectedSlot.empId,
          businessDate: selectedSlot.businessDate ?? bookingDate,
          branchCode: selectedSlot.branchCode ?? branchCode ?? undefined,
        });
        setSelectedSlot(null);
        setSlotStaleNotice(BOOKING_V2_SLOT_STALE_NOTICE_AR);
        setStep(3);
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(extractBookingCreateErrorMessage(data));
      }

      const successResult = parseBookingCreateSuccess(data) ?? {
        actualDate: data.booking?.actualDate || data.booking?.date || bookingDate,
        bookingId: data.booking?.id,
        code: data.booking?.code,
      };

      notifyBookingV2CreateSuccess({
        createResponse: data,
        fallbackSlot: {
          empId: selectedSlot.empId,
          branchCode: selectedSlot.branchCode ?? branchCode,
          businessDate: selectedSlot.businessDate ?? bookingDate,
          startAt: selectedSlot.startAt,
          endAt: selectedSlot.endAt,
        },
      });

      setSubmitting(false);
      releaseSubmitGuard(submittingRef);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[ops-booking-perf] submitting_cleared', {
          msSinceConfirm: Math.round(performance.now() - submitT0),
        });
      }

      setSuccess(true);
      const finish = () => {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ops-booking-perf] onCreated_onClose', {
            msSinceConfirm: Math.round(performance.now() - submitT0),
            delayMs: BOOKING_SUCCESS_CLOSE_DELAY_MS,
          });
        }
        // Refresh is owned by the parent — fire-and-forget via onCreated; do not await.
        onCreated?.(successResult);
        onClose();
      };

      if (BOOKING_SUCCESS_CLOSE_DELAY_MS <= 0) {
        finish();
      } else {
        setTimeout(finish, BOOKING_SUCCESS_CLOSE_DELAY_MS);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'فشل إنشاء الحجز');
    } finally {
      if (submittingRef.current) {
        releaseSubmitGuard(submittingRef);
        setSubmitting(false);
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ops-booking-perf] submitting_cleared', {
            msSinceConfirm: Math.round(performance.now() - submitT0),
          });
        }
      }
    }
  };

  const slotsAreCurrent =
    (slotsViewState === 'ready' || slotsViewState === 'empty')
    && selectedServices.length > 0
    && availableSlots.every((s) => s.durationMinutes === totalDuration);

  const canGoStep2 = !isDatePast && (mode === 'nearest' || !!selectedBarberId);
  const canGoStep3 = selectedServices.length > 0;
  const canGoStep4 =
    !!selectedSlot
    && slotsAreCurrent
    && slotsViewState === 'ready'
    && selectedSlot.durationMinutes === totalDuration;
  const canGoStep5 = !!(customerName.trim() || selectedClient);
  const canSubmit = canGoStep4 && canGoStep5;

  const stepHint = useMemo(() => {
    if (step === 1 && !canGoStep2) {
      if (isDatePast) return 'التاريخ المحدد في الماضي';
      if (mode === 'specific' && !selectedBarberId) return 'اختر الحلاق للمتابعة';
    }
    if (step === 2 && !canGoStep3) return 'اختر خدمة واحدة على الأقل';
    if (step === 3 && !canGoStep4) {
      if (slotsViewState === 'loading') return 'جاري تحميل المواعيد...';
      if (slotsViewState === 'error') return 'تعذر تحميل المواعيد';
      return 'اختر موعدًا متاحًا';
    }
    if (step === 4 && !canGoStep5) return 'أضف بيانات العميل';
    return null;
  }, [step, canGoStep2, canGoStep3, canGoStep4, canGoStep5, isDatePast, mode, selectedBarberId, slotsViewState]);

  const goNext = () => {
    if (step < 5) setStep((s) => (s + 1) as BookingStep);
  };

  const goBack = () => {
    if (step > 1) setStep((s) => (s - 1) as BookingStep);
  };

  const goToStep = (target: BookingStep) => {
    if (target < step) setStep(target);
  };

  const stepSummaries = useMemo(() => ({
    1: mode === 'nearest' ? 'أقرب حلاق' : (selectedBarberName || 'حلاق معين'),
    2: selectedServices.length
      ? `${selectedServices.length} خدمة • ${totalDuration} دقيقة`
      : undefined,
    3: selectedSlot ? slotDisplayLabel(selectedSlot) : undefined,
    4: selectedClient?.Name || customerName.trim() || undefined,
    5: undefined,
  }), [mode, selectedBarberName, selectedServices.length, totalDuration, selectedSlot, selectedClient, customerName]);

  const handleSelectBarber = useCallback((empId: number) => {
    setSelectedBarberId(empId);
    // Prefer session branch if employee works there; else first mapped branch.
    const codes = getEmployeeBranchCodesFromStore(empId);
    if (codes.length) {
      const preferred =
        sessionBranchCode && codes.includes(sessionBranchCode.toUpperCase())
          ? sessionBranchCode.toUpperCase()
          : codes[0];
      setSelectedBranchCode(preferred);
    }
    invalidateSlotSelection();
  }, [invalidateSlotSelection, sessionBranchCode]);

  return {
    modalRef,
    step,
    mode,
    services: displayServices,
    loadingServices,
    selectedServices,
    bookingDate,
    selectedBarberId,
    selectedBranchCode: branchCode,
    employeeBranchCodes,
    showDatePicker,
    setShowDatePicker,
    setSelectedBarberId,
    availableSlots,
    loadingSlots,
    slotsViewState,
    slotsError,
    availabilitySoftError,
    selectedSlot,
    setSelectedSlot,
    filterByTimeRange,
    setFilterByTimeRange,
    gapNotice,
    nextAvailable,
    alternativeBarbers,
    slotStaleNotice,
    slotsMeta,
    displaySlots,
    preferredRangeSlots,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    notes,
    setNotes,
    clientSearch,
    setClientSearch,
    clients,
    selectedClient,
    setSelectedClient,
    showClients,
    setShowClients,
    submitting,
    error,
    setError,
    success,
    totalDuration,
    totalPrice,
    serviceIds,
    selectedBarberName,
    hasTimeRange,
    isDatePast,
    isToday,
    isTomorrow,
    lockedBarber,
    initialTimeRangeStart,
    initialTimeRangeEnd,
    initialBarberName,
    barbers: displayBarbers,
    loadingDateBarbers,
    slotsAreCurrent,
    canGoStep2,
    canGoStep3,
    canGoStep4,
    canGoStep5,
    canSubmit,
    stepHint,
    handleDateChange,
    handleBranchChange,
    handleModeChange,
    handleSelectBarber,
    handleMainSelect,
    handleToggleAddon,
    removeService,
    handleSubmit,
    goNext,
    goBack,
    goToStep,
    stepSummaries,
    fetchSlots,
    retryAvailability,
    formatDateLabel,
    getOperationalToday,
    getOperationalTomorrow,
    /** @deprecated alias — returns operational today for booking date picker */
    getCairoToday: getOperationalToday,
    /** @deprecated alias — returns day after operational today */
    getCairoTomorrow: getOperationalTomorrow,
  };
}

function slotDisplayLabel(slot: AvailableSlot): string {
  if (slot.label) return slot.label;
  if (slot.startAt && slot.endAt) {
    const fmt = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const suffix = h >= 12 ? 'م' : 'ص';
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
    };
    const start = fmt(new Date(slot.startAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }));
    const end = fmt(new Date(slot.endAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }));
    return `${start} – ${end}`;
  }
  return slot.time;
}
