'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, Search, User, Scissors, Loader2, CheckCircle2,
  Calendar, Clock, AlertTriangle, ChevronRight, ChevronLeft,
  Users, Sparkles,
} from 'lucide-react';

interface Service {
  ProID: number;
  ProName: string;
  SPrice: number;
  SPrice1?: number;
  DurationMinutes: number | null;
}

interface Client {
  ClientID: number;
  Name: string;
  Mobile?: string;
}

interface AvailableSlot {
  time: string;
  endTime: string;
  label: string;
  empId: number;
  barberName: string;
  durationMinutes: number;
  dayOffset?: 0 | 1;
  startAt?: string;
  endAt?: string;
  available: boolean;
}

interface GapNotice {
  gapStart: string;
  gapEnd: string;
  gapMinutes: number;
  requiredMinutes: number;
  message: string;
}

interface BarberAlternative {
  empId: number;
  empName: string;
  time: string;
  endTime: string;
}

interface Barber {
  empId: number;
  empName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialDate?: string;
  initialTime?: string;
  initialEmpId?: number;
  initialBarberName?: string;
  initialTimeRangeStart?: string;
  initialTimeRangeEnd?: string;
  barbers: Barber[];
  onCreated?: () => void;
}

type Mode = 'nearest' | 'specific';

const GOLD = 'var(--primary)';
const GOLD_BG = 'color-mix(in srgb, var(--primary) 10%, transparent)';
const GOLD_BDR = 'color-mix(in srgb, var(--primary) 35%, transparent)';
const SURFACE = 'var(--surface)';
const BORDER = 'var(--border)';

function getCairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function getCairoTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function isPastCairoDate(dateStr: string): boolean {
  return dateStr < getCairoToday();
}

function sanitizeDate(dateStr: string | undefined): string {
  const today = getCairoToday();
  if (!dateStr || dateStr < today) return today;
  return dateStr;
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

function fmt(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isSlotInsideRange(slot: AvailableSlot, rangeStart: string, rangeEnd: string): boolean {
  const s = timeToMinutes(slot.time);
  const end = timeToMinutes(slot.endTime || slot.time);
  return s >= timeToMinutes(rangeStart) && end <= timeToMinutes(rangeEnd);
}

export function CreateBookingDrawer({
  open,
  onClose,
  initialDate,
  initialTime,
  initialEmpId,
  initialBarberName,
  initialTimeRangeStart,
  initialTimeRangeEnd,
  barbers,
  onCreated,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<Mode>(initialEmpId ? 'specific' : 'nearest');

  const [services, setServices] = useState<Service[]>([]);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);

  const [bookingDate, setBookingDate] = useState(() => sanitizeDate(initialDate));
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(initialEmpId || null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [gapNotice, setGapNotice] = useState<GapNotice | null>(null);
  const [nextAvailable, setNextAvailable] = useState<AvailableSlot | null>(null);
  const [alternativeBarbers, setAlternativeBarbers] = useState<BarberAlternative[]>([]);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClients, setShowClients] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [slotsDebugReason, setSlotsDebugReason] = useState<string | null>(null);

  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchGenRef = useRef(0);

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
    if (!hasTimeRange || showAllSlots) return availableSlots;
    return availableSlots.filter((s) =>
      isSlotInsideRange(s, initialTimeRangeStart!, initialTimeRangeEnd!),
    );
  }, [availableSlots, hasTimeRange, showAllSlots, initialTimeRangeStart, initialTimeRangeEnd]);

  const invalidateSlotSelection = useCallback(() => {
    setSelectedSlot(null);
    setAvailableSlots([]);
    setGapNotice(null);
    setNextAvailable(null);
    setAlternativeBarbers([]);
    setSlotsDebugReason(null);
  }, []);

  useEffect(() => {
    fetch('/api/services?active=true')
      .then((r) => r.json())
      .then((d) => {
        const raw: Service[] = d.services ?? (Array.isArray(d) ? d : []);
        setServices(raw.map((s) => ({ ...s, SPrice: s.SPrice ?? s.SPrice1 ?? 0 })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) {
      setShowAllSlots(false);
      setSelectedSlot(null);
      setSelectedServices([]);
      setSelectedClient(null);
      setCustomerName('');
      setCustomerPhone('');
      setClientSearch('');
      setError(null);
      setSlotsDebugReason(null);
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
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const slots: AvailableSlot[] = (data.availableSlots ?? []).map((s: AvailableSlot) => ({
        ...s,
        available: true,
      }));

      setAvailableSlots(slots);
      setGapNotice(data.gapNotice ?? data.debug?.gapNotice ?? null);
      setNextAvailable(data.nextAvailable ?? null);
      setAlternativeBarbers(data.alternativeBarbers ?? data.debug?.alternativeBarbers ?? []);

      if (slots.length === 0) {
        setSlotsDebugReason(
          data.noSlotsReason
          ?? data.debug?.noSlotsReason
          ?? null,
        );
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      if (gen === fetchGenRef.current) setAvailableSlots([]);
    } finally {
      if (gen === fetchGenRef.current) setLoadingSlots(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingDate, serviceIdsKey, mode, selectedBarberId, invalidateSlotSelection]);

  useEffect(() => {
    if (step === 2 && serviceIds.length > 0) fetchSlots();
    return () => fetchAbortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bookingDate, serviceIdsKey, mode, selectedBarberId]);

  useEffect(() => {
    if (step >= 2) invalidateSlotSelection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceIdsKey, mode, selectedBarberId, bookingDate]);

  const handleDateChange = (newDate: string) => {
    setBookingDate(newDate);
    invalidateSlotSelection();
    setShowAllSlots(false);
    setShowDatePicker(false);
    setError(null);
  };

  const handleModeChange = (next: Mode) => {
    setMode(next);
    if (next === 'specific') {
      setSelectedBarberId(initialEmpId || selectedBarberId || null);
    }
    invalidateSlotSelection();
  };

  const toggleService = (svc: Service) => {
    setSelectedServices((prev) =>
      prev.some((s) => s.ProID === svc.ProID)
        ? prev.filter((s) => s.ProID !== svc.ProID)
        : [...prev, svc],
    );
    invalidateSlotSelection();
  };

  const handleSubmit = async () => {
    if (!selectedSlot || !selectedServices.length) return;
    setError(null);
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
        notes: '',
        source: 'operations',
      };
      const res = await fetch('/api/public/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 409) {
        setError(data.message || data.error || 'الوقت المختار لم يعد متاحًا');
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'فشل إنشاء الحجز');
      setSuccess(true);
      setTimeout(() => { onCreated?.(); onClose(); }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'فشل إنشاء الحجز');
    } finally {
      setSubmitting(false);
    }
  };

  const canGoStep2 =
    selectedServices.length > 0
    && !isDatePast
    && (mode === 'nearest' || !!selectedBarberId);
  const canGoStep3 = !!selectedSlot && !loadingSlots;
  const canSubmit = !!(customerName || selectedClient);

  if (!open) return null;

  if (success) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/75 backdrop-blur-sm" dir="rtl">
        <div className="rounded-2xl border p-8 text-center space-y-3" style={{ background: 'var(--surface-elevated)', borderColor: BORDER }}>
          <CheckCircle2 size={40} className="text-success mx-auto" />
          <p className="font-bold text-foreground text-lg">تم إنشاء الحجز</p>
          <p className="text-sm text-muted-foreground/70">
            {formatDateLabel(bookingDate)} — {selectedSlot?.label ?? ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-start sm:justify-end bg-background/60 backdrop-blur-sm" onClick={onClose} dir="rtl">
      <div
        className="h-[100dvh] sm:h-full w-full sm:max-w-md flex flex-col shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface-elevated)', borderLeft: `1px solid ${BORDER}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b flex-shrink-0" style={{ borderColor: BORDER }}>
          <h2 className="font-bold text-foreground text-base">إنشاء حجز جديد</h2>
          <button type="button" onClick={onClose} className="p-2 min-h-[44px] min-w-[44px] rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-surface-muted transition-all">
            <X size={15} />
          </button>
        </div>

        {/* Sticky context bar */}
        {selectedServices.length > 0 && (
          <div className="px-4 sm:px-5 py-2.5 border-b flex-shrink-0" style={{ borderColor: BORDER, background: GOLD_BG }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-bold" style={{ color: GOLD }}>
                {mode === 'specific' && selectedBarberName
                  ? selectedBarberName
                  : selectedSlot?.barberName
                    ? selectedSlot.barberName
                    : 'أقرب حلاق متاح'}
              </span>
              <span className="text-muted-foreground">{formatDateLabel(bookingDate)}</span>
              <span className="text-muted-foreground">{selectedServices.length} خدمة</span>
              <span className="font-bold" style={{ color: GOLD }}>{totalDuration} دقيقة</span>
              {selectedSlot && (
                <span className="font-semibold text-foreground">{selectedSlot.label}</span>
              )}
            </div>
          </div>
        )}

        {/* Date bar */}
        <div className="px-4 sm:px-5 py-2.5 border-b flex-shrink-0" style={{ borderColor: BORDER }}>
          {showDatePicker ? (
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" onClick={() => handleDateChange(getCairoToday())} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: GOLD_BDR, color: GOLD }}>اليوم</button>
              <button type="button" onClick={() => handleDateChange(getCairoTomorrow())} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: BORDER }}>غدًا</button>
              <input type="date" value={bookingDate} min={getCairoToday()} onChange={(e) => e.target.value && handleDateChange(e.target.value)} className="flex-1 min-h-[44px] rounded-lg border px-2 text-xs bg-transparent" style={{ borderColor: BORDER, colorScheme: 'dark' }} />
              <button type="button" onClick={() => setShowDatePicker(false)} className="p-2 min-h-[44px] min-w-[44px]"><X size={13} /></button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <Calendar size={13} style={{ color: GOLD }} />
                <span>{isToday ? 'اليوم — ' : isTomorrow ? 'غدًا — ' : ''}{formatDateLabel(bookingDate)}</span>
              </div>
              <button type="button" onClick={() => setShowDatePicker(true)} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: GOLD_BDR, color: GOLD }}>تغيير التاريخ</button>
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="flex items-center gap-0 px-4 sm:px-5 py-3 border-b flex-shrink-0 overflow-x-auto" style={{ borderColor: BORDER }}>
          {[{ num: 1, label: 'الخدمة' }, { num: 2, label: 'الموعد' }, { num: 3, label: 'العميل' }].map((s, idx) => (
            <div key={s.num} className="flex items-center flex-shrink-0">
              <button type="button" onClick={() => { if (s.num < step) setStep(s.num as 1 | 2 | 3); }} className="flex items-center gap-2 px-2 py-1.5 rounded-lg">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: step >= s.num ? GOLD : BORDER, color: step >= s.num ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }}>
                  {step > s.num ? '✓' : s.num}
                </div>
                <span className="text-xs font-medium" style={{ color: step >= s.num ? GOLD : 'var(--muted-foreground)' }}>{s.label}</span>
              </button>
              {idx < 2 && <ChevronLeft size={12} className="text-muted-foreground/50" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">

          {/* STEP 1 */}
          {step === 1 && (
            <div className="flex flex-col pb-4">
              <div className="px-4 sm:px-5 pt-4 space-y-4">
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">طريقة الحجز</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'nearest' as const, label: 'أقرب حلاق', sub: 'أول حلاق متاح', icon: Sparkles },
                      { value: 'specific' as const, label: 'حلاق معين', sub: lockedBarber ? initialBarberName : 'اختر الحلاق', icon: User },
                    ].map((m) => {
                      const active = mode === m.value;
                      const Icon = m.icon;
                      const disabled = lockedBarber && m.value === 'nearest';
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => !disabled && handleModeChange(m.value)}
                          disabled={disabled}
                          className="relative flex flex-col items-center gap-1 p-3 min-h-[88px] rounded-xl border-2 transition-all text-center"
                          style={{
                            borderColor: active ? GOLD : BORDER,
                            background: active ? GOLD_BG : 'transparent',
                            opacity: disabled ? 0.5 : 1,
                          }}
                        >
                          {active && <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: GOLD }} />}
                          <Icon size={20} style={{ color: active ? GOLD : 'var(--muted-foreground)' }} />
                          <span className="text-sm font-bold" style={{ color: active ? GOLD : 'var(--foreground)' }}>{m.label}</span>
                          <span className="text-[10px] text-muted-foreground leading-tight">{m.sub}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {mode === 'specific' && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">الحلاق المختار</p>
                    {lockedBarber && initialBarberName ? (
                      <div className="p-3 rounded-xl border text-center" style={{ borderColor: GOLD_BDR, background: GOLD_BG }}>
                        <p className="text-base font-bold" style={{ color: GOLD }}>{initialBarberName}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {barbers.map((b) => {
                          const active = selectedBarberId === b.empId;
                          return (
                            <button
                              key={b.empId}
                              type="button"
                              onClick={() => { setSelectedBarberId(b.empId); invalidateSlotSelection(); }}
                              className="p-3 rounded-xl border-2 text-center transition-all min-h-[64px]"
                              style={{
                                borderColor: active ? GOLD : BORDER,
                                background: active ? GOLD_BG : 'transparent',
                              }}
                            >
                              <p className="text-sm font-bold" style={{ color: active ? GOLD : 'var(--foreground)' }}>{b.empName}</p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {!selectedBarberId && !lockedBarber && (
                      <p className="text-xs text-warning">اختر الحلاق للمتابعة</p>
                    )}
                  </div>
                )}
              </div>

              <div className="px-4 sm:px-5 pt-4 pb-2">
                <p className="text-xs font-semibold text-muted-foreground mb-2">اختر الخدمات</p>
                <div className="space-y-2">
                  {services.map((svc) => {
                    const isSelected = selectedServices.some((s) => s.ProID === svc.ProID);
                    return (
                      <button
                        key={svc.ProID}
                        type="button"
                        onClick={() => toggleService(svc)}
                        className="w-full text-right p-3 min-h-[56px] rounded-xl border transition-all flex items-center gap-3"
                        style={{ borderColor: isSelected ? GOLD : BORDER, background: isSelected ? GOLD_BG : 'transparent' }}
                      >
                        <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: isSelected ? GOLD : 'var(--muted-foreground)', background: isSelected ? GOLD : 'transparent' }}>
                          {isSelected && <span className="text-primary-foreground text-xs font-bold">✓</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{svc.ProName}</p>
                          <p className="text-xs text-muted-foreground">{svc.DurationMinutes ?? 30} د · {svc.SPrice ?? 0} ج.م</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedServices.length > 0 && (
                <div className="sticky bottom-0 mx-4 sm:mx-5 mt-4 p-4 rounded-xl border" style={{ borderColor: GOLD_BDR, background: 'var(--surface-elevated)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div>
                      <p className="font-bold text-foreground">{selectedServices.length} خدمة · {totalDuration} دقيقة</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {mode === 'specific' && selectedBarberName ? `الحلاق: ${selectedBarberName}` : selectedSlot?.barberName ? `الحلاق: ${selectedSlot.barberName}` : 'أقرب حلاق متاح'}
                      </p>
                    </div>
                    <p className="text-lg font-bold" style={{ color: GOLD }}>{totalPrice} ج.م</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="px-4 sm:px-5 py-4 space-y-4">
              <div className="p-3 rounded-xl space-y-1" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                <p className="text-xs font-semibold" style={{ color: GOLD }}>
                  {mode === 'specific' && selectedBarberName ? `${selectedBarberName} • ` : 'أقرب حلاق • '}
                  {formatDateLabel(bookingDate)}
                </p>
                <p className="text-xs text-muted-foreground truncate">{selectedServices.map((s) => s.ProName).join(' + ')}</p>
                <p className="text-sm font-bold" style={{ color: GOLD }}>الوقت المطلوب: {totalDuration} دقيقة</p>
              </div>

              {gapNotice && (
                <div className="flex gap-2 p-3 rounded-xl border border-warning/40 bg-warning/10">
                  <AlertTriangle size={16} className="text-warning flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-warning leading-relaxed">{gapNotice.message}</p>
                </div>
              )}

              {loadingSlots && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={18} className="animate-spin" style={{ color: GOLD }} />
                    <span>جارٍ حساب المواعيد المتاحة لـ {totalDuration} دقيقة...</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="p-3 min-h-[72px] rounded-xl border animate-pulse" style={{ borderColor: BORDER, background: SURFACE }}>
                        <div className="h-4 w-1/2 rounded mb-2" style={{ background: BORDER }} />
                        <div className="h-3 w-3/4 rounded" style={{ background: BORDER }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!loadingSlots && filteredSlots.length === 0 && (
                <div className="text-center py-8 space-y-3">
                  <AlertTriangle size={28} className="mx-auto text-warning" />
                  <p className="text-sm font-semibold text-foreground">
                    {slotsDebugReason
                      ?? (mode === 'specific' && selectedBarberName
                        ? `لا توجد فترة متصلة مدتها ${totalDuration} دقيقة متاحة مع ${selectedBarberName} في هذا اليوم.`
                        : 'لا توجد مواعيد متاحة')}
                  </p>
                  {nextAvailable && (
                    <div className="p-3 rounded-xl border" style={{ borderColor: GOLD_BDR, background: GOLD_BG }}>
                      <p className="text-xs font-semibold" style={{ color: GOLD }}>أقرب موعد متاح</p>
                      <p className="text-sm font-bold">{nextAvailable.label}</p>
                      {mode === 'nearest' && <p className="text-xs text-muted-foreground">مع {nextAvailable.barberName}</p>}
                    </div>
                  )}
                  {alternativeBarbers.length > 0 && (
                    <div className="text-xs space-y-2 pt-2">
                      <p className="text-muted-foreground font-semibold">حلاقات بديلة</p>
                      {alternativeBarbers.slice(0, 3).map((alt) => (
                        <button
                          key={alt.empId}
                          type="button"
                          onClick={() => {
                            setMode('specific');
                            setSelectedBarberId(alt.empId);
                            setStep(1);
                          }}
                          className="w-full p-2 rounded-lg border text-xs text-right"
                          style={{ borderColor: BORDER, background: SURFACE }}
                        >
                          <span className="font-semibold">{alt.empName}</span> متاح: {fmt(alt.time)} – {fmt(alt.endTime)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap justify-center gap-2 pt-2">
                    {mode === 'specific' && !lockedBarber && (
                      <button type="button" onClick={() => { setMode('nearest'); setStep(1); }} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs font-semibold" style={{ borderColor: GOLD, color: GOLD }}>أقرب حلاق</button>
                    )}
                    <button type="button" onClick={() => setStep(1)} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs" style={{ borderColor: BORDER }}>تغيير الخدمات</button>
                    <button type="button" onClick={() => setShowDatePicker(true)} className="px-3 py-2 min-h-[44px] rounded-lg border text-xs" style={{ borderColor: BORDER }}>تغيير التاريخ</button>
                  </div>
                </div>
              )}

              {!loadingSlots && filteredSlots.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    اختر موعداً متصلاً مدته {totalDuration} دقيقة
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredSlots.map((slot) => {
                      const isSelected = selectedSlot?.time === slot.time && selectedSlot?.empId === slot.empId;
                      return (
                        <button
                          key={`${slot.empId}-${slot.time}-${slot.dayOffset ?? 0}`}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className="text-right p-3 min-h-[80px] rounded-xl border-2 transition-all"
                          style={{
                            borderColor: isSelected ? GOLD : BORDER,
                            background: isSelected ? GOLD_BG : SURFACE,
                          }}
                        >
                          <p className="text-sm font-bold" style={{ color: isSelected ? GOLD : 'var(--foreground)' }}>
                            {slot.label || `${fmt(slot.time)} – ${fmt(slot.endTime)}`}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Users size={11} /> {mode === 'nearest' ? `مع ${slot.barberName}` : slot.barberName}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{slot.durationMinutes} دقيقة</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedSlot && !loadingSlots && (
                <div className="p-3 rounded-xl border" style={{ borderColor: 'var(--success)', background: 'color-mix(in srgb, var(--success) 5%, transparent)' }}>
                  <p className="text-xs text-success font-semibold mb-1">✓ {selectedSlot.label}</p>
                  <p className="text-sm text-foreground">الحلاق: {selectedSlot.barberName}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP 3 — customer (unchanged structure, compact) */}
          {step === 3 && (
            <div className="px-4 sm:px-5 py-4 space-y-4">
              <div className="p-4 rounded-xl border space-y-2" style={{ borderColor: BORDER, background: SURFACE }}>
                <p className="text-xs font-semibold text-muted-foreground">ملخص الحجز</p>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">التاريخ</span><span>{formatDateLabel(bookingDate)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">الوقت</span><span className="font-semibold">{selectedSlot?.label}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">الحلاق</span><span>{selectedSlot?.barberName}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">المدة</span><span>{totalDuration} دقيقة</span></div>
              </div>

              <div className="relative">
                <p className="text-xs font-semibold text-muted-foreground mb-2">بحث عن عميل</p>
                {selectedClient ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border" style={{ borderColor: 'var(--success)' }}>
                    <span className="text-sm">{selectedClient.Name}</span>
                    <button type="button" onClick={() => setSelectedClient(null)}><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-xl border min-h-[44px]" style={{ borderColor: BORDER }}>
                      <Search size={16} className="text-muted-foreground/70" />
                      <input className="flex-1 bg-transparent text-sm outline-none" placeholder="ابحث بالاسم أو الهاتف..." value={clientSearch} onChange={(e) => { setClientSearch(e.target.value); setShowClients(true); }} />
                    </div>
                    {showClients && clients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-xl z-10 overflow-hidden" style={{ background: 'var(--surface-muted)', borderColor: BORDER }}>
                        {clients.slice(0, 6).map((c) => (
                          <button key={c.ClientID} type="button" className="w-full text-right px-4 py-3 min-h-[44px] hover:bg-surface-muted text-sm" onClick={() => { setSelectedClient(c); setClientSearch(''); setShowClients(false); }}>
                            {c.Name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="space-y-3">
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="اسم العميل *" className="w-full min-h-[44px] rounded-xl border px-3 text-sm bg-transparent" style={{ borderColor: BORDER }} />
                <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="رقم الهاتف (اختياري)" className="w-full min-h-[44px] rounded-xl border px-3 text-sm bg-transparent" style={{ borderColor: BORDER }} dir="ltr" />
              </div>

              {error && (
                <div className="flex gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/5">
                  <AlertTriangle size={16} className="text-destructive flex-shrink-0" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-4 border-t flex-shrink-0 space-y-2" style={{ borderColor: BORDER }}>
          {step === 1 && (
            <button type="button" onClick={() => setStep(2)} disabled={!canGoStep2} className="w-full min-h-[48px] py-3 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: canGoStep2 ? `linear-gradient(135deg,${GOLD},var(--primary-active))` : BORDER, color: canGoStep2 ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }}>
              التالي — اختيار الموعد <ChevronLeft size={16} />
            </button>
          )}
          {step === 2 && (
            <button type="button" onClick={() => setStep(3)} disabled={!canGoStep3} className="w-full min-h-[48px] py-3 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: canGoStep3 ? `linear-gradient(135deg,${GOLD},var(--primary-active))` : BORDER, color: canGoStep3 ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }}>
              التالي — بيانات العميل <ChevronLeft size={16} />
            </button>
          )}
          {step === 3 && (
            <button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting} className="w-full min-h-[48px] py-3 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg,var(--success),var(--success-active))', color: 'var(--foreground)' }}>
              {submitting ? <><Loader2 size={16} className="animate-spin" /> جاري الحجز...</> : <><CheckCircle2 size={16} /> تأكيد الحجز</>}
            </button>
          )}
          {step > 1 && (
            <button type="button" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} className="w-full min-h-[44px] py-2 rounded-xl text-xs text-muted-foreground/70 flex items-center justify-center gap-1">
              <ChevronRight size={13} /> رجوع
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
