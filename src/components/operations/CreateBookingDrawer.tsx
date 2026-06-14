'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Search, User, Scissors, Loader2, CheckCircle2,
  Calendar, Clock, AlertTriangle, ChevronRight, ChevronLeft,
  Users,
} from 'lucide-react';

interface Service {
  ProID: number;
  ProName: string;
  SPrice: number;   // normalized from SPrice1
  SPrice1?: number; // raw field from API
  DurationMinutes: number | null;
}

interface Client {
  ClientID: number;
  Name: string;
  Mobile?: string;
}

interface AvailableSlot {
  time: string;
  label: string;
  empId: number;
  barberName: string;
  durationMinutes: number;
  durationSource: string;
  available: boolean;
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

// ── Pure helpers ──────────────────────────────────────────────────────────────

function getCairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function getCairoTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/** Returns true if dateStr (YYYY-MM-DD) is strictly before today in Cairo time */
function isPastCairoDate(dateStr: string): boolean {
  return dateStr < getCairoToday();
}

/** Returns dateStr if it is today or future in Cairo; otherwise returns cairoToday */
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

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Group available slots by their hour label (e.g. "5 م", "6 م") */
function groupSlotsByHour(slots: AvailableSlot[]): { label: string; slots: AvailableSlot[] }[] {
  const map = new Map<string, AvailableSlot[]>();
  for (const s of slots) {
    const [h] = s.time.split(':').map(Number);
    const suffix = h >= 12 ? 'م' : 'ص';
    const h12 = h % 12 || 12;
    const key = `${h12} ${suffix}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries()).map(([label, slots]) => ({ label, slots }));
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isSlotInsideRange(slot: AvailableSlot, rangeStart: string, rangeEnd: string, dur: number): boolean {
  const s = timeToMinutes(slot.time);
  return s >= timeToMinutes(rangeStart) && s + (slot.durationMinutes ?? dur) <= timeToMinutes(rangeEnd);
}

// ── Accent palette ────────────────────────────────────────────────────────────
const GOLD = '#D4AF37';
const GOLD_BG = 'rgba(212,175,55,0.10)';
const GOLD_BDR = 'rgba(212,175,55,0.35)';
const SURFACE = '#1A1A22';
const BORDER = '#2A2A38';

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
  // ── State ────────────────────────────────────────────────────────────────────

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<Mode>(initialEmpId ? 'specific' : 'nearest');

  // Multi-service selection (Step 1)
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);

  // Date + mode
  const [bookingDate, setBookingDate] = useState(() => sanitizeDate(initialDate));
  const [selectedBarberId, setSelectedBarberId] = useState<number | null>(initialEmpId || null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Slots + time+barber selection (Step 2)
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(initialTime || null);
  const [selectedBarberForSlot, setSelectedBarberForSlot] = useState<AvailableSlot | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);

  // Customer (Step 3)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClients, setShowClients] = useState(false);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [slotsDebugReason, setSlotsDebugReason] = useState<string | null>(null);

  // ── Computed ──────────────────────────────────────────────────────────────────

  const totalDuration = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.DurationMinutes ?? 30), 0),
    [selectedServices]
  );
  const totalPrice = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.SPrice ?? 0), 0),
    [selectedServices]
  );
  const serviceIds = useMemo(() => selectedServices.map(s => s.ProID), [selectedServices]);

  const hasTimeRange = !!initialTimeRangeStart && !!initialTimeRangeEnd;
  const isDatePast = isPastCairoDate(bookingDate);
  const isToday = bookingDate === getCairoToday();
  const isTomorrow = bookingDate === getCairoTomorrow();

  // Barbers available at selectedTime (from slot data)
  const barbersAtTime = useMemo(() => {
    if (!selectedTime) return [];
    return availableSlots.filter(s => s.time === selectedTime && s.available);
  }, [availableSlots, selectedTime]);

  // Auto-select barber if only one option
  useEffect(() => {
    if (barbersAtTime.length === 1) setSelectedBarberForSlot(barbersAtTime[0]);
    else if (barbersAtTime.length === 0) setSelectedBarberForSlot(null);
  }, [barbersAtTime]);

  // Slots filtered by time range (for calendar cell open)
  const filteredSlots = useMemo(() => {
    const onlyAvailable = availableSlots.filter(s => s.available);
    if (!hasTimeRange || showAllSlots) return onlyAvailable;
    return onlyAvailable.filter(s => isSlotInsideRange(s, initialTimeRangeStart!, initialTimeRangeEnd!, totalDuration));
  }, [availableSlots, hasTimeRange, showAllSlots, initialTimeRangeStart, initialTimeRangeEnd, totalDuration]);

  // Unique times (for time grid — each time shown once)
  const uniqueTimes = useMemo(() => {
    const seen = new Set<string>();
    return filteredSlots.filter(s => { if (seen.has(s.time)) return false; seen.add(s.time); return true; });
  }, [filteredSlots]);

  const groupedSlots = useMemo(() => groupSlotsByHour(uniqueTimes), [uniqueTimes]);

  // ── Load services once ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/services?active=true')
      .then(r => r.json())
      .then(d => {
        const raw: any[] = d.services ?? (Array.isArray(d) ? d : []);
        // Normalize: API returns SPrice1, map to SPrice so price always renders
        const normalized = raw.map(s => ({
          ...s,
          SPrice: s.SPrice ?? s.SPrice1 ?? 0,
        }));
        setServices(normalized);
      })
      .catch(() => {});
  }, []);

  // Reset on open
  useEffect(() => {
    if (open) {
      setShowAllSlots(false);
      setSelectedTime(initialTime || null);
      setSelectedBarberForSlot(null);
      setSelectedServices([]);
      setSelectedClient(null);
      setCustomerName('');
      setCustomerPhone('');
      setClientSearch('');
      setError(null);
      setSlotsDebugReason(null);
      setStep(1);
      setSuccess(false);
      setSelectedBarberId(initialEmpId || null);
      setBookingDate(sanitizeDate(initialDate));
      setShowDatePicker(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Client search ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (clientSearch.length < 2) { setClients([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(clientSearch)}`)
        .then(r => r.json())
        .then(d => { setClients(Array.isArray(d) ? d : (d.clients ?? d.data ?? [])); setShowClients(true); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch]);

  // ── Fetch slots ───────────────────────────────────────────────────────────────
  // Stable string key so the effect fires whenever the set of IDs actually changes
  const serviceIdsKey = serviceIds.join(',');

  const fetchSlots = useCallback(async () => {
    if (!serviceIds.length || !bookingDate) return;
    if (isPastCairoDate(bookingDate)) return;
    if (mode === 'specific' && !selectedBarberId) return;
    setLoadingSlots(true);
    setAvailableSlots([]);
    setSlotsDebugReason(null);
    setError(null);
    const base = `/api/public/booking/available-slots?date=${bookingDate}&serviceIds=${serviceIdsKey}&source=operations`;
    const url = mode === 'specific' && selectedBarberId
      ? `${base}&mode=specific&empId=${selectedBarberId}`
      : `${base}&mode=nearest`;
    console.log('[CreateBookingDrawer] fetchSlots', {
      bookingDate,
      serviceIds,
      serviceIdsKey,
      totalDuration,
      totalPrice,
      mode,
      selectedBarberId,
      url,
    });
    try {
      const res = await fetch(url);
      const data = await res.json();
      const allSlots: AvailableSlot[] = data.slots ?? [];
      const available = allSlots.filter((s: AvailableSlot) => s.available);
      console.log('[CreateBookingDrawer] fetchSlots response', {
        totalSlots: allSlots.length,
        availableSlots: available.length,
        debug: data.debug,
      });
      setAvailableSlots(available);
      // Extract a reason for empty state from the debug payload
      if (available.length === 0) {
        const dbg = data.debug;
        const reason = dbg?.noSlotsReason
          ?? (dbg?.totalBarbers === 0 ? 'لا يوجد موظفون نشطون' : null)
          ?? (dbg?.allBarbersOffToday ? 'جميع الموظفين في إجازة' : null)
          ?? null;
        setSlotsDebugReason(reason);
      }
    } catch (e) {
      console.error('[CreateBookingDrawer] fetchSlots error', e);
      setAvailableSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingDate, serviceIdsKey, mode, selectedBarberId]);

  // Trigger fetch whenever we're on step 2 AND any key dependency changes
  useEffect(() => {
    if (step === 2 && serviceIds.length > 0) fetchSlots();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bookingDate, serviceIdsKey, mode, selectedBarberId]);

  // ── Date change (resets time/barber/slots, keeps services & customer) ─────────
  const handleDateChange = (newDate: string) => {
    setBookingDate(newDate);
    setSelectedTime(null);
    setSelectedBarberForSlot(null);
    setAvailableSlots([]);
    setShowAllSlots(false);
    setShowDatePicker(false);
    setError(null);
  };

  // ── Toggle service ────────────────────────────────────────────────────────────
  const toggleService = (svc: Service) => {
    setSelectedServices(prev =>
      prev.some(s => s.ProID === svc.ProID)
        ? prev.filter(s => s.ProID !== svc.ProID)
        : [...prev, svc]
    );
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedBarberForSlot || !selectedTime || !selectedServices.length) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        customer: { name: selectedClient?.Name || customerName, phone: selectedClient?.Mobile || customerPhone },
        serviceIds,
        date: bookingDate,
        time: selectedTime,
        mode: 'specific',
        empId: selectedBarberForSlot.empId,
        notes: '',
        source: 'operations',
      };
      const res = await fetch('/api/public/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 409) { setError('الموعد لم يعد متاحًا، اختر ميعادًا آخر'); return; }
      if (!res.ok || !data.ok) throw new Error(data.error || 'فشل إنشاء الحجز');
      setSuccess(true);
      setTimeout(() => { onCreated?.(); onClose(); }, 1500);
    } catch (err: any) {
      setError(err?.message || 'فشل إنشاء الحجز');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Validation ────────────────────────────────────────────────────────────────
  const canGoStep2 = selectedServices.length > 0 && !isDatePast;
  const canGoStep3 = !!selectedTime && !!selectedBarberForSlot;
  const canSubmit  = !!(customerName || selectedClient);

  if (!open) return null;

  // ── Success screen ────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-sm" dir="rtl">
        <div className="rounded-2xl border p-8 text-center space-y-3" style={{ background: '#141418', borderColor: BORDER }}>
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto" />
          <p className="font-bold text-white text-lg">تم إنشاء الحجز</p>
          <p className="text-sm text-zinc-500">{formatDateLabel(bookingDate)} — {selectedTime ? fmt(selectedTime) : ''}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/60 backdrop-blur-sm" onClick={onClose} dir="rtl">
      <div
        className="h-full w-full max-w-md flex flex-col shadow-2xl overflow-hidden"
        style={{ background: '#141418', borderLeft: `1px solid ${BORDER}` }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: BORDER }}>
          <h2 className="font-bold text-white text-base">إنشاء حجز جديد</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
            <X size={15} />
          </button>
        </div>

        {/* ── Date bar (visible in all steps) ── */}
        <div className="px-5 py-2.5 border-b flex-shrink-0" style={{ borderColor: BORDER, background: isDatePast ? 'rgba(239,68,68,0.06)' : GOLD_BG }}>
          {showDatePicker ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400">اختر تاريخًا</p>
              {/* Quick chips */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleDateChange(getCairoToday())}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all"
                  style={{
                    borderColor: bookingDate === getCairoToday() ? GOLD : BORDER,
                    background: bookingDate === getCairoToday() ? GOLD_BG : 'transparent',
                    color: bookingDate === getCairoToday() ? GOLD : '#9CA3AF',
                  }}
                >
                  اليوم
                </button>
                <button
                  onClick={() => handleDateChange(getCairoTomorrow())}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all"
                  style={{
                    borderColor: bookingDate === getCairoTomorrow() ? GOLD : BORDER,
                    background: bookingDate === getCairoTomorrow() ? GOLD_BG : 'transparent',
                    color: bookingDate === getCairoTomorrow() ? GOLD : '#9CA3AF',
                  }}
                >
                  غدًا
                </button>
                <input
                  type="date"
                  value={bookingDate}
                  min={getCairoToday()}
                  onChange={e => e.target.value && handleDateChange(e.target.value)}
                  className="flex-1 rounded-lg border px-2 py-1.5 text-xs text-white bg-transparent outline-none"
                  style={{ borderColor: BORDER, colorScheme: 'dark' }}
                />
                <button
                  onClick={() => setShowDatePicker(false)}
                  className="p-1.5 rounded-lg text-zinc-500 hover:text-white transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar size={13} style={{ color: isDatePast ? '#EF4444' : GOLD }} />
                <span className="text-xs text-zinc-400">تاريخ الحجز:</span>
                <span className="text-sm font-semibold" style={{ color: isDatePast ? '#EF4444' : '#fff' }}>
                  {isToday ? 'اليوم — ' : isTomorrow ? 'غدًا — ' : ''}{formatDateLabel(bookingDate)}
                </span>
              </div>
              <button
                onClick={() => setShowDatePicker(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all hover:opacity-80"
                style={{ borderColor: isDatePast ? '#EF4444' : GOLD_BDR, color: isDatePast ? '#EF4444' : GOLD, background: 'transparent' }}
              >
                <Calendar size={11} />
                تغيير التاريخ
              </button>
            </div>
          )}

          {/* Past-date warning */}
          {isDatePast && !showDatePicker && (
            <div className="flex items-center gap-2 mt-2">
              <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">هذا التاريخ مضى، اختر تاريخًا جديدًا</p>
            </div>
          )}
        </div>

        {/* ── Step indicator ── */}
        <div className="flex items-center gap-0 px-5 py-3 border-b flex-shrink-0" style={{ borderColor: BORDER }}>
          {[{ num: 1, label: 'الخدمة' }, { num: 2, label: 'الموعد' }, { num: 3, label: 'العميل' }].map((s, idx) => (
            <div key={s.num} className="flex items-center">
              <button
                onClick={() => { if (s.num < step) setStep(s.num as 1 | 2 | 3); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
                style={{ cursor: s.num < step ? 'pointer' : 'default' }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: step > s.num ? GOLD : step === s.num ? GOLD : BORDER,
                    color: step >= s.num ? '#000' : '#6B7280',
                  }}
                >
                  {step > s.num ? '✓' : s.num}
                </div>
                <span className="text-xs font-medium" style={{ color: step >= s.num ? GOLD : '#6B7280' }}>{s.label}</span>
              </button>
              {idx < 2 && <ChevronLeft size={12} className="text-zinc-700 flex-shrink-0" />}
            </div>
          ))}

          {/* Service summary pill in header */}
          {selectedServices.length > 0 && step > 1 && (
            <div className="mr-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs" style={{ background: GOLD_BG, border: `1px solid ${GOLD_BDR}`, color: GOLD }}>
              <Scissors size={11} />
              <span>{selectedServices.length} خدمة · {totalDuration} د</span>
            </div>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ════════════════════════════════════════
              STEP 1 — MULTI-SERVICE SELECTION
              ════════════════════════════════════════ */}
          {step === 1 && (
            <div className="flex flex-col h-full">

              {/* Prefilled info from calendar */}
              {(initialBarberName || initialTime) && (
                <div className="px-5 pt-4">
                  <div className="p-3 rounded-xl border mb-1" style={{ borderColor: GOLD_BDR, background: GOLD_BG }}>
                    <p className="text-xs text-zinc-400 mb-1">معلومات الموعد المختار:</p>
                    {initialBarberName && <p className="text-sm text-white">الحلاق: <span style={{ color: GOLD }}>{initialBarberName}</span></p>}
                    {hasTimeRange
                      ? <p className="text-sm text-white">الفترة: <span style={{ color: GOLD }}>{fmt(initialTimeRangeStart!)} — {fmt(initialTimeRangeEnd!)}</span></p>
                      : initialTime && <p className="text-sm text-white">الوقت: <span style={{ color: GOLD }}>{fmt(initialTime)}</span></p>
                    }
                  </div>
                </div>
              )}

              {/* Mode + date row */}
              <div className="px-5 pt-4 pb-3 flex items-center gap-3">
                {/* Mode toggle */}
                <div className="flex rounded-lg overflow-hidden border flex-shrink-0" style={{ borderColor: BORDER }}>
                  {([{ value: 'nearest', label: 'أقرب حلاق' }, { value: 'specific', label: 'حلاق معين' }] as const).map(m => (
                    <button
                      key={m.value}
                      onClick={() => { setMode(m.value); setSelectedBarberId(initialEmpId || null); }}
                      disabled={m.value === 'specific' && !!initialEmpId && mode === 'specific'}
                      className="px-3 py-1.5 text-xs font-semibold transition-all"
                      style={{
                        background: mode === m.value ? GOLD : 'transparent',
                        color: mode === m.value ? '#000' : '#9CA3AF',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Barber picker (specific + no prefill) */}
                {mode === 'specific' && !initialEmpId && (
                  <select
                    value={selectedBarberId ?? ''}
                    onChange={e => setSelectedBarberId(Number(e.target.value) || null)}
                    className="flex-1 rounded-lg border px-3 py-1.5 text-xs text-white bg-transparent outline-none"
                    style={{ borderColor: BORDER, background: SURFACE, colorScheme: 'dark' }}
                  >
                    <option value="">اختر الحلاق</option>
                    {barbers.map(b => <option key={b.empId} value={b.empId}>{b.empName}</option>)}
                  </select>
                )}
              </div>

              {/* Services list — scrollable */}
              <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-2">
                <p className="text-xs font-semibold text-zinc-400 mb-2 sticky top-0 py-1" style={{ background: '#141418' }}>
                  اختر الخدمات <span className="text-zinc-600 font-normal">(يمكن اختيار أكثر من خدمة)</span>
                </p>

                {services.length === 0 && (
                  <div className="text-center py-8">
                    <Loader2 size={22} className="animate-spin mx-auto mb-2" style={{ color: GOLD }} />
                    <p className="text-xs text-zinc-500">جاري تحميل الخدمات...</p>
                  </div>
                )}

                {services.map(svc => {
                  const isSelected = selectedServices.some(s => s.ProID === svc.ProID);
                  return (
                    <button
                      key={svc.ProID}
                      onClick={() => toggleService(svc)}
                      className="w-full text-right p-3 rounded-xl border transition-all flex items-center gap-3 group"
                      style={{
                        borderColor: isSelected ? GOLD : BORDER,
                        background: isSelected ? GOLD_BG : 'transparent',
                      }}
                    >
                      {/* Checkbox indicator */}
                      <div
                        className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                        style={{
                          borderColor: isSelected ? GOLD : '#4B5563',
                          background: isSelected ? GOLD : 'transparent',
                        }}
                      >
                        {isSelected && <span className="text-black text-xs font-bold leading-none">✓</span>}
                      </div>

                      {/* Icon */}
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: isSelected ? 'rgba(212,175,55,0.2)' : SURFACE }}
                      >
                        <Scissors size={16} style={{ color: isSelected ? GOLD : '#6B7280' }} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: isSelected ? GOLD : '#fff' }}>
                          {svc.ProName}
                        </p>
                        <p className="text-xs text-zinc-500">{svc.DurationMinutes ?? 30} دقيقة</p>
                      </div>

                      {/* Price */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold" style={{ color: isSelected ? GOLD : '#9CA3AF' }}>
                          {svc.SPrice ?? 0} ج
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected chips */}
              {selectedServices.length > 0 && (
                <div className="px-5 pt-2 pb-1 flex flex-wrap gap-1.5">
                  {selectedServices.map(svc => (
                    <span
                      key={svc.ProID}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: GOLD_BG, border: `1px solid ${GOLD_BDR}`, color: GOLD }}
                    >
                      {svc.ProName}
                      <button onClick={() => toggleService(svc)} className="hover:opacity-70 transition-opacity">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Summary strip */}
              {selectedServices.length > 0 && (
                <div className="px-5 py-3 border-t flex items-center gap-4" style={{ borderColor: BORDER }}>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Scissors size={12} style={{ color: GOLD }} />
                    <span>{selectedServices.length} خدمة</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Clock size={12} style={{ color: GOLD }} />
                    <span>{totalDuration} دقيقة</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: GOLD }}>
                    <span>{totalPrice} ج.م</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════
              STEP 2 — TIME → BARBER
              ════════════════════════════════════════ */}
          {step === 2 && (
            <div className="px-5 py-4 space-y-5">

              {/* Services + date summary strip */}
              <div className="p-3 rounded-xl space-y-1.5" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2">
                  <Calendar size={12} style={{ color: GOLD }} />
                  <span className="text-xs font-semibold" style={{ color: GOLD }}>
                    {isToday ? 'اليوم — ' : isTomorrow ? 'غدًا — ' : ''}{formatDateLabel(bookingDate)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Scissors size={12} style={{ color: GOLD }} />
                  <p className="text-xs text-zinc-400 flex-1 truncate">{selectedServices.map(s => s.ProName).join(' + ')}</p>
                  <span className="text-zinc-400 text-xs flex-shrink-0"><Clock size={10} className="inline ml-1" />{totalDuration} د</span>
                  <span style={{ color: GOLD }} className="font-bold text-xs flex-shrink-0">{totalPrice} ج</span>
                </div>
              </div>

              {/* Past-date gate */}
              {isDatePast && (
                <div className="text-center py-10">
                  <AlertTriangle size={26} className="mx-auto mb-3 text-red-400" />
                  <p className="text-sm text-red-400 font-semibold">هذا التاريخ مضى</p>
                  <p className="text-xs text-zinc-500 mt-1">اختر تاريخًا جديدًا من الأعلى</p>
                  <button
                    onClick={() => setShowDatePicker(true)}
                    className="mt-4 px-4 py-2 rounded-lg border text-xs font-semibold"
                    style={{ borderColor: GOLD, color: GOLD }}
                  >
                    تغيير التاريخ
                  </button>
                </div>
              )}

              {/* Loading */}
              {!isDatePast && loadingSlots && (
                <div className="text-center py-10">
                  <Loader2 size={26} className="animate-spin mx-auto mb-3" style={{ color: GOLD }} />
                  <p className="text-sm text-zinc-500">جاري تحميل المواعيد المتاحة...</p>
                  <p className="text-xs text-zinc-600 mt-1">المدة الإجمالية: {totalDuration} دقيقة</p>
                </div>
              )}

              {/* No slots */}
              {!isDatePast && !loadingSlots && uniqueTimes.length === 0 && (
                <div className="text-center py-10">
                  <AlertTriangle size={26} className="mx-auto mb-3 text-amber-500" />
                  <p className="text-sm text-zinc-400">لا توجد مواعيد متاحة</p>
                  {slotsDebugReason ? (
                    <p className="text-xs mt-1.5 px-4" style={{ color: '#f59e0b' }}>{slotsDebugReason}</p>
                  ) : (
                    <p className="text-xs text-zinc-600 mt-1">جرب تغيير التاريخ أو تقليل الخدمات</p>
                  )}
                  <p className="text-xs text-zinc-700 mt-2">
                    {formatDateLabel(bookingDate)} · {totalDuration} دقيقة · {serviceIds.length} خدمة
                  </p>
                  {hasTimeRange && !showAllSlots && availableSlots.length > 0 && (
                    <button
                      onClick={() => setShowAllSlots(true)}
                      className="mt-3 px-4 py-1.5 rounded-lg border text-xs"
                      style={{ borderColor: GOLD, color: GOLD }}
                    >
                      عرض كل مواعيد اليوم
                    </button>
                  )}
                </div>
              )}

              {/* Time range filter notice */}
              {!isDatePast && hasTimeRange && !showAllSlots && uniqueTimes.length > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <Clock size={13} />
                    <span>مواعيد الفترة {fmt(initialTimeRangeStart!)} — {fmt(initialTimeRangeEnd!)}</span>
                  </div>
                  <button
                    onClick={() => setShowAllSlots(true)}
                    className="text-xs underline text-zinc-500 hover:text-zinc-300"
                  >
                    عرض الكل
                  </button>
                </div>
              )}

              {/* Hour-grouped time grid */}
              {!isDatePast && !loadingSlots && groupedSlots.length > 0 && (
                <div className="space-y-4">
                  {groupedSlots.map(group => (
                    <div key={group.label}>
                      {/* Hour divider */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-zinc-500 flex-shrink-0">{group.label}</span>
                        <div className="flex-1 h-px" style={{ background: BORDER }} />
                      </div>

                      {/* Slot buttons — time only, clean */}
                      <div className="grid grid-cols-4 gap-2">
                        {group.slots.map(slot => {
                          const isSelected = selectedTime === slot.time;
                          return (
                            <button
                              key={slot.time}
                              onClick={() => {
                                setSelectedTime(slot.time);
                                setSelectedBarberForSlot(null);
                              }}
                              className="py-2.5 px-2 rounded-xl border text-center transition-all"
                              style={{
                                borderColor: isSelected ? GOLD : BORDER,
                                background: isSelected ? GOLD_BG : 'transparent',
                              }}
                            >
                              <p className="text-sm font-bold leading-none" style={{ color: isSelected ? GOLD : '#fff' }}>
                                {fmt(slot.time)}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Barber panel — appears after time selected ── */}
              {!isDatePast && selectedTime && !loadingSlots && (
                <div className="pt-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Users size={14} style={{ color: GOLD }} />
                    <p className="text-sm font-semibold text-white">الحلاقون المتاحون — {fmt(selectedTime)}</p>
                    {selectedTime && totalDuration > 0 && (
                      <span className="text-xs text-zinc-500 mr-auto">ينتهي {fmt(addMinutes(selectedTime, totalDuration))}</span>
                    )}
                  </div>

                  {barbersAtTime.length === 0 && (
                    <div className="p-4 rounded-xl border text-center" style={{ borderColor: BORDER, background: SURFACE }}>
                      <p className="text-sm text-zinc-500">لا يوجد حلاق متاح لهذا الوقت</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {barbersAtTime.map(slot => {
                      const isChosen = selectedBarberForSlot?.empId === slot.empId;
                      const autoChosen = barbersAtTime.length === 1;
                      return (
                        <button
                          key={slot.empId}
                          onClick={() => setSelectedBarberForSlot(slot)}
                          className="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-right"
                          style={{
                            borderColor: isChosen ? '#10B981' : BORDER,
                            background: isChosen ? 'rgba(16,185,129,0.06)' : SURFACE,
                          }}
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: isChosen ? 'rgba(16,185,129,0.15)' : '#222230' }}
                          >
                            <User size={16} style={{ color: isChosen ? '#10B981' : '#6B7280' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white">{slot.barberName}</p>
                            {autoChosen && !isChosen && (
                              <p className="text-xs text-zinc-500">الوحيد المتاح</p>
                            )}
                          </div>
                          {isChosen
                            ? <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
                            : <div className="w-4 h-4 rounded-full border flex-shrink-0" style={{ borderColor: BORDER }} />
                          }
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Selected summary */}
              {!isDatePast && selectedTime && selectedBarberForSlot && (
                <div className="p-3 rounded-xl border" style={{ borderColor: '#10B981', background: 'rgba(16,185,129,0.05)' }}>
                  <p className="text-xs text-emerald-400 mb-1.5 font-semibold">✓ تم اختيار الموعد</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">الوقت</span>
                    <span className="text-white font-bold">{fmt(selectedTime)} — {fmt(addMinutes(selectedTime, totalDuration))}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-zinc-400">الحلاق</span>
                    <span className="text-white">{selectedBarberForSlot.barberName}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════
              STEP 3 — CUSTOMER
              ════════════════════════════════════════ */}
          {step === 3 && (
            <div className="px-5 py-4 space-y-4">

              {/* Full booking summary */}
              <div className="p-4 rounded-xl border space-y-2" style={{ borderColor: BORDER, background: SURFACE }}>
                <p className="text-xs font-semibold text-zinc-400 mb-2">ملخص الحجز</p>

                {/* Date */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Calendar size={13} style={{ color: GOLD }} />
                    <span>التاريخ</span>
                  </div>
                  <span className="text-sm text-white font-semibold">
                    {isToday ? 'اليوم — ' : isTomorrow ? 'غدًا — ' : ''}{formatDateLabel(bookingDate)}
                  </span>
                </div>

                <div className="h-px" style={{ background: BORDER }} />

                {/* Services */}
                <div className="flex items-start gap-2">
                  <Scissors size={13} style={{ color: GOLD }} className="mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    {selectedServices.map(s => (
                      <p key={s.ProID} className="text-sm text-white">{s.ProName} <span className="text-zinc-500 text-xs">({s.DurationMinutes ?? 30} د)</span></p>
                    ))}
                  </div>
                  <span className="text-sm font-bold flex-shrink-0" style={{ color: GOLD }}>{totalPrice} ج</span>
                </div>

                <div className="h-px" style={{ background: BORDER }} />

                {/* Time */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Clock size={13} style={{ color: GOLD }} />
                    <span>الوقت</span>
                  </div>
                  <span className="text-sm text-white font-semibold">
                    {selectedTime ? `${fmt(selectedTime)} — ${fmt(addMinutes(selectedTime, totalDuration))}` : '—'}
                  </span>
                </div>

                {/* Barber */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <User size={13} style={{ color: GOLD }} />
                    <span>الحلاق</span>
                  </div>
                  <span className="text-sm text-white">{selectedBarberForSlot?.barberName ?? '—'}</span>
                </div>

                {/* Duration */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">المدة الإجمالية</span>
                  <span className="text-xs text-zinc-400">{totalDuration} دقيقة</span>
                </div>
              </div>

              {/* Client search */}
              <div className="relative">
                <p className="text-xs font-semibold text-zinc-400 mb-2">بحث عن عميل موجود</p>
                {selectedClient ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border" style={{ borderColor: '#10B981', background: 'rgba(16,185,129,0.05)' }}>
                    <div className="flex items-center gap-2">
                      <User size={16} className="text-emerald-400" />
                      <div>
                        <p className="text-sm text-white">{selectedClient.Name}</p>
                        {selectedClient.Mobile && <p className="text-xs text-zinc-500">{selectedClient.Mobile}</p>}
                      </div>
                    </div>
                    <button onClick={() => setSelectedClient(null)} className="p-1 text-zinc-500 hover:text-white">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-xl border" style={{ borderColor: BORDER, background: SURFACE }}>
                      <Search size={16} className="text-zinc-500" />
                      <input
                        className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
                        placeholder="ابحث بالاسم أو الهاتف..."
                        value={clientSearch}
                        onChange={e => { setClientSearch(e.target.value); setShowClients(true); }}
                      />
                    </div>
                    {showClients && clients.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border shadow-xl z-10 overflow-hidden" style={{ background: '#1E1D21', borderColor: BORDER }}>
                        {clients.slice(0, 6).map(c => (
                          <button
                            key={c.ClientID}
                            className="w-full text-right px-4 py-2.5 hover:bg-zinc-800 transition-colors text-sm text-white"
                            onClick={() => { setSelectedClient(c); setClientSearch(''); setShowClients(false); }}
                          >
                            {c.Name}
                            {c.Mobile && <span className="text-zinc-500 text-xs mr-2">{c.Mobile}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* New customer form */}
              <div>
                <p className="text-xs font-semibold text-zinc-400 mb-2">أو إدخال بيانات جديدة</p>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="اسم العميل *"
                    className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-transparent placeholder-zinc-600 outline-none focus:ring-1 transition-all"
                    style={{ borderColor: BORDER }}
                  />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="رقم الهاتف (اختياري)"
                    className="w-full rounded-xl border px-3 py-2.5 text-sm text-white bg-transparent placeholder-zinc-600 outline-none"
                    style={{ borderColor: BORDER }}
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/5">
                  <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-4 border-t flex-shrink-0 space-y-2" style={{ borderColor: BORDER }}>

          {step === 1 && (
            <button
              onClick={() => { setStep(2); setSelectedTime(initialTime || null); setSelectedBarberForSlot(null); }}
              disabled={!canGoStep2}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: canGoStep2 ? `linear-gradient(135deg,${GOLD},#B8941F)` : BORDER, color: canGoStep2 ? '#000' : '#6B7280' }}
            >
              التالي — اختيار الموعد <ChevronLeft size={16} />
            </button>
          )}

          {step === 2 && (
            <button
              onClick={() => setStep(3)}
              disabled={!canGoStep3}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: canGoStep3 ? `linear-gradient(135deg,${GOLD},#B8941F)` : BORDER, color: canGoStep3 ? '#000' : '#6B7280' }}
            >
              التالي — بيانات العميل <ChevronLeft size={16} />
            </button>
          )}

          {step === 3 && (
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#10B981,#059669)', color: '#fff' }}
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> جاري الحجز...</>
                : <><CheckCircle2 size={16} /> تأكيد الحجز</>
              }
            </button>
          )}

          {step > 1 && (
            <button
              onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
              className="w-full py-2 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center justify-center gap-1"
            >
              <ChevronRight size={13} /> رجوع
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
