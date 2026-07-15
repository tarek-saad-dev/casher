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
  getCairoToday,
  getCairoTomorrow,
  isPastCairoDate,
  isSlotInsideRange,
  sanitizeDate,
} from './types';
import {
  acquireSubmitGuard,
  BOOKING_SUCCESS_CLOSE_DELAY_MS,
  parseBookingCreateSuccess,
  releaseSubmitGuard,
  type BookingCreateSuccess,
} from '@/lib/operations/bookingWorkspaceSubmit';

export interface UseBookingWorkspaceArgs {
  open: boolean;
  initialDate?: string;
  initialEmpId?: number;
  initialBarberName?: string;
  initialTimeRangeStart?: string;
  initialTimeRangeEnd?: string;
  barbers: BookingWorkspaceBarber[];
  onClose: () => void;
  onCreated?: (result?: BookingCreateSuccess) => void;
}

export function useBookingWorkspace({
  open,
  initialDate,
  initialEmpId,
  initialBarberName,
  initialTimeRangeStart,
  initialTimeRangeEnd,
  barbers,
  onClose,
  onCreated,
}: UseBookingWorkspaceArgs) {
  const [step, setStep] = useState<BookingStep>(1);
  const [mode, setMode] = useState<BookingMode>(initialEmpId ? 'specific' : 'nearest');

  const [services, setServices] = useState<BookingService[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectedServices, setSelectedServices] = useState<BookingService[]>([]);

  const [bookingDate, setBookingDate] = useState(() => sanitizeDate(initialDate));
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(initialEmpId || null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [filterByTimeRange, setFilterByTimeRange] = useState(false);
  const [gapNotice, setGapNotice] = useState<GapNotice | null>(null);
  const [nextAvailable, setNextAvailable] = useState<AvailableSlot | null>(null);
  const [alternativeBarbers, setAlternativeBarbers] = useState<BarberAlternative[]>([]);
  const [slotsDebugReason, setSlotsDebugReason] = useState<string | null>(null);
  const [slotsMeta, setSlotsMeta] = useState<{
    validSlotCountBeforeLimit?: number;
    returnedSlotCount?: number;
    limitApplied?: boolean;
  } | null>(null);
  const [slotsFetchedForKey, setSlotsFetchedForKey] = useState<string | null>(null);

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

  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchGenRef = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);

  const totalDuration = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.DurationMinutes ?? 30), 0),
    [selectedServices],
  );
  const totalPrice = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.SPrice ?? 0), 0),
    [selectedServices],
  );
  const serviceIds = useMemo(() => selectedServices.map((s) => s.ProID), [selectedServices]);
  const serviceIdsKey = serviceIds.join(',');

  const selectedBarberName = useMemo(() => {
    if (mode === 'specific' && selectedBarberId) {
      return barbers.find((b) => b.empId === selectedBarberId)?.empName
        ?? initialBarberName
        ?? '';
    }
    return '';
  }, [mode, selectedBarberId, barbers, initialBarberName]);

  const hasTimeRange = !!initialTimeRangeStart && !!initialTimeRangeEnd;
  const isDatePast = isPastCairoDate(bookingDate);
  const isToday = bookingDate === getCairoToday();
  const isTomorrow = bookingDate === getCairoTomorrow();
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
    setAvailableSlots([]);
    setSlotsFetchedForKey(null);
    setGapNotice(null);
    setNextAvailable(null);
    setAlternativeBarbers([]);
    setSlotsDebugReason(null);
    setSlotsMeta(null);
  }, []);

  const beginSlotRefresh = useCallback(() => {
    invalidateSlotSelection();
    setLoadingSlots(true);
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
    setSlotsDebugReason(null);
    setSlotsMeta(null);
    setSlotsFetchedForKey(null);
    setGapNotice(null);
    setNextAvailable(null);
    setAlternativeBarbers([]);
    setStep(1);
    setSuccess(false);
    setMode(initialEmpId ? 'specific' : 'nearest');
    setSelectedBarberId(initialEmpId || null);
    setBookingDate(sanitizeDate(initialDate));
    setShowDatePicker(false);
    setAvailableSlots([]);
  }, [initialDate, initialEmpId]);

  useEffect(() => {
    setLoadingServices(true);
    fetch('/api/services?active=true')
      .then((r) => r.json())
      .then((d) => {
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
      .finally(() => setLoadingServices(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    resetWorkspace();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const fetchSlots = useCallback(async () => {
    if (!serviceIds.length || !bookingDate) return;
    if (isPastCairoDate(bookingDate)) return;
    if (mode === 'specific' && !selectedBarberId) return;

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const gen = ++fetchGenRef.current;

    setLoadingSlots(true);
    invalidateSlotSelection();

    const requestId = `r${gen}`;
    const base = `/api/public/booking/available-slots?date=${bookingDate}&serviceIds=${serviceIdsKey}&source=operations&requestId=${requestId}`;
    const url = mode === 'specific' && selectedBarberId
      ? `${base}&mode=specific&empId=${selectedBarberId}`
      : `${base}&mode=nearest`;

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (gen !== fetchGenRef.current) return;
      const data = await res.json();
      if (!res.ok) {
        setSlotsDebugReason(data.message || data.error || 'تعذر تحميل المواعيد، حاول مرة أخرى.');
        setAvailableSlots([]);
        return;
      }
      const expectedDuration = Number(data.serviceDurationMinutes ?? totalDuration);
      const rawSlots: AvailableSlot[] = (data.slots ?? data.availableSlots ?? []).map((s: AvailableSlot) => ({
        ...s,
        available: true,
      }));

      const slots = rawSlots.filter((s) => Number(s.durationMinutes ?? 0) === expectedDuration);

      setAvailableSlots(slots);
      setSlotsFetchedForKey(serviceIdsKey);
      setSlotsMeta({
        validSlotCountBeforeLimit: data.debug?.validSlotCountBeforeLimit ?? slots.length,
        returnedSlotCount: data.debug?.slotsAvailable ?? slots.length,
        limitApplied: data.debug?.limitApplied ?? false,
      });
      setGapNotice(data.gapNotice ?? null);
      setNextAvailable(data.nextAvailable ?? null);
      setAlternativeBarbers(data.alternativeBarbers ?? []);

      if (slots.length === 0) {
        setSlotsDebugReason(data.noSlotsReason ?? data.debug?.noSlotsReason ?? null);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      if (gen === fetchGenRef.current) {
        setAvailableSlots([]);
        setSlotsDebugReason('تعذر تحميل المواعيد، حاول مرة أخرى.');
      }
    } finally {
      if (gen === fetchGenRef.current) setLoadingSlots(false);
    }
  }, [bookingDate, serviceIdsKey, mode, selectedBarberId, invalidateSlotSelection, totalDuration, serviceIds.length]);

  useEffect(() => {
    if (step === 3 && serviceIds.length > 0) fetchSlots();
    return () => fetchAbortRef.current?.abort();
  }, [step, bookingDate, serviceIdsKey, mode, selectedBarberId, fetchSlots, serviceIds.length]);

  const handleDateChange = (newDate: string) => {
    setBookingDate(newDate);
    invalidateSlotSelection();
    setFilterByTimeRange(false);
    setShowDatePicker(false);
    setError(null);
  };

  const handleModeChange = (next: BookingMode) => {
    setMode(next);
    if (next === 'specific') {
      setSelectedBarberId(initialEmpId || selectedBarberId || null);
    }
    invalidateSlotSelection();
  };

  const MAIN_SERVICE_NAMES = useMemo(
    () => [
      'Hair Cut', 'Haircut', 'Detailed Cut', 'Detail Cut', 'DetailedCut',
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
    const svc = services.find((s) => s.ProID === proId);
    if (!svc) return;
    setSelectedServices((prev) => {
      const addonIds = prev.filter((s) => !isMainService(s.ProName)).map((s) => s.ProID);
      const addons = services.filter((s) => addonIds.includes(s.ProID));
      return [svc, ...addons];
    });
    invalidateSlotSelection();
  }, [services, isMainService, invalidateSlotSelection]);

  const handleToggleAddon = useCallback((proId: number) => {
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.ProID === proId);
      if (exists) return prev.filter((s) => s.ProID !== proId);
      const svc = services.find((s) => s.ProID === proId);
      return svc ? [...prev, svc] : prev;
    });
    invalidateSlotSelection();
  }, [services, invalidateSlotSelection]);

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
      const payload = {
        customer: {
          name: selectedClient?.Name || customerName,
          phone: selectedClient?.Mobile || customerPhone || '01000000000',
        },
        serviceIds,
        date: bookingDate,
        time: selectedSlot.time,
        dayOffset: selectedSlot.dayOffset ?? 0,
        mode: mode === 'specific' ? 'specific' : 'nearest',
        empId: selectedSlot.empId,
        notes: notes.trim(),
        source: 'operations',
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
        setError(data.message || data.error || 'الوقت المختار لم يعد متاحًا، اختر موعدًا آخر.');
        invalidateSlotSelection();
        setStep(3);
        void fetchSlots();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'فشل إنشاء الحجز');

      const successResult = parseBookingCreateSuccess(data) ?? {
        actualDate: data.booking?.actualDate || data.booking?.date || bookingDate,
        bookingId: data.booking?.id,
        code: data.booking?.code,
      };

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

  const slotsAreCurrent = slotsFetchedForKey === serviceIdsKey;

  const canGoStep2 = !isDatePast && (mode === 'nearest' || !!selectedBarberId);
  const canGoStep3 = selectedServices.length > 0;
  const canGoStep4 =
    !!selectedSlot
    && slotsAreCurrent
    && !loadingSlots
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
      if (loadingSlots) return 'جارٍ حساب المواعيد...';
      return 'اختر موعدًا متاحًا';
    }
    if (step === 4 && !canGoStep5) return 'أضف بيانات العميل';
    return null;
  }, [step, canGoStep2, canGoStep3, canGoStep4, canGoStep5, isDatePast, mode, selectedBarberId, loadingSlots]);

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
    invalidateSlotSelection();
  }, [invalidateSlotSelection]);

  return {
    modalRef,
    step,
    mode,
    services,
    loadingServices,
    selectedServices,
    bookingDate,
    selectedBarberId,
    showDatePicker,
    setShowDatePicker,
    setSelectedBarberId,
    availableSlots,
    loadingSlots,
    selectedSlot,
    setSelectedSlot,
    filterByTimeRange,
    setFilterByTimeRange,
    gapNotice,
    nextAvailable,
    alternativeBarbers,
    slotsDebugReason,
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
    barbers,
    slotsAreCurrent,
    canGoStep2,
    canGoStep3,
    canGoStep4,
    canGoStep5,
    canSubmit,
    stepHint,
    handleDateChange,
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
    formatDateLabel,
    getCairoToday,
    getCairoTomorrow,
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
