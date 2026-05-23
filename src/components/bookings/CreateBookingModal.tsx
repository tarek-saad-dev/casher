'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, ChevronRight, ChevronLeft, Loader2, User, Scissors,
  CalendarDays, Clock, CheckCircle2, AlertCircle, Users, UserCheck,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Barber {
  id: number;
  name: string;
  job: string;
}

interface Service {
  id: number;
  name: string;
  price: number;
  durationMinutes: number;
  categoryName: string | null;
}

interface DayOption {
  date: string;
  label: string;
  available: boolean;
  reason?: string;
}

interface Slot {
  time: string;
  label: string;
  available: boolean;
  dayOffset?: number;
  empId?: number;
  barberName?: string;
  durationMinutes?: number;
}

type BookingMode = 'nearest' | 'specific';
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (bookingCode?: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateAr(dateStr: string): string {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('ar-EG', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return dateStr; }
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CreateBookingModal({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>(1);

  // selections
  const [mode, setMode] = useState<BookingMode>('nearest');
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [days, setDays] = useState<DayOption[]>([]);
  const [selectedDay, setSelectedDay] = useState<DayOption | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');

  // loading / error
  const [loadingBarbers, setLoadingBarbers]   = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingDays, setLoadingDays]         = useState(false);
  const [loadingSlots, setLoadingSlots]       = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const submitGuard = useRef(false);

  // ── Reset on open ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMode('nearest');
    setSelectedBarber(null);
    setSelectedService(null);
    setSelectedDay(null);
    setSelectedSlot(null);
    setCustomerName('');
    setCustomerPhone('');
    setNotes('');
    setError(null);
    submitGuard.current = false;
  }, [open]);

  // ── Fetch barbers (when entering step 2 with specific mode) ───────────────
  const fetchBarbers = useCallback(async () => {
    if (barbers.length) return;
    setLoadingBarbers(true);
    setError(null);
    try {
      const res = await fetch('/api/public/booking/barbers');
      const data = await res.json();
      setBarbers(data.barbers ?? []);
    } catch {
      setError('فشل تحميل الحلاقين');
    } finally {
      setLoadingBarbers(false);
    }
  }, [barbers.length]);

  // ── Fetch services (step 3) ────────────────────────────────────────────────
  const fetchServices = useCallback(async () => {
    if (services.length) return;
    setLoadingServices(true);
    setError(null);
    try {
      const res = await fetch('/api/public/booking/services?limit=50');
      const data = await res.json();
      setServices(data.services ?? []);
    } catch {
      setError('فشل تحميل الخدمات');
    } finally {
      setLoadingServices(false);
    }
  }, [services.length]);

  // ── Fetch available days (step 4) ─────────────────────────────────────────
  const fetchDays = useCallback(async (
    currentMode: BookingMode,
    empId: number | null,
    serviceId: number | null,
  ) => {
    setLoadingDays(true);
    setError(null);
    setDays([]);
    setSelectedDay(null);
    setSelectedSlot(null);
    try {
      const params = new URLSearchParams({ mode: currentMode });
      if (currentMode === 'specific' && empId) params.set('empId', String(empId));
      if (serviceId) params.set('serviceIds', String(serviceId));
      const res = await fetch(`/api/public/booking/available-days?${params}`);
      const data = await res.json();
      setDays((data.days ?? []).filter((d: DayOption) => d.available));
    } catch {
      setError('فشل تحميل الأيام المتاحة');
    } finally {
      setLoadingDays(false);
    }
  }, []);

  // ── Fetch slots (step 5) ───────────────────────────────────────────────────
  const fetchSlots = useCallback(async (
    date: string,
    currentMode: BookingMode,
    empId: number | null,
    serviceId: number | null,
  ) => {
    setLoadingSlots(true);
    setError(null);
    setSlots([]);
    setSelectedSlot(null);
    try {
      const params = new URLSearchParams({ date, mode: currentMode });
      if (currentMode === 'specific' && empId) params.set('empId', String(empId));
      if (serviceId) params.set('serviceIds', String(serviceId));
      const res = await fetch(`/api/public/booking/available-slots?${params}`);
      const data = await res.json();
      setSlots((data.slots ?? []).filter((s: Slot) => s.available));
    } catch {
      setError('فشل تحميل المواعيد');
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goTo = useCallback((next: Step) => {
    setError(null);
    setStep(next);
  }, []);

  // Step 1 → Step 2 (or 3 if nearest)
  const handleModeConfirm = () => {
    if (mode === 'specific') {
      fetchBarbers();
      goTo(2);
    } else {
      fetchServices();
      goTo(3);
    }
  };

  // Step 2 → Step 3
  const handleBarberSelect = (b: Barber) => {
    setSelectedBarber(b);
    fetchServices();
    goTo(3);
  };

  // Step 3 → Step 4
  const handleServiceSelect = (s: Service) => {
    setSelectedService(s);
    const empId = mode === 'specific' && selectedBarber ? selectedBarber.id : null;
    fetchDays(mode, empId, s.id);
    goTo(4);
  };

  // Step 4 → Step 5
  const handleDaySelect = (d: DayOption) => {
    setSelectedDay(d);
    const empId = mode === 'specific' && selectedBarber ? selectedBarber.id : null;
    fetchSlots(d.date, mode, empId, selectedService?.id ?? null);
    goTo(5);
  };

  // Step 5 → Step 6
  const handleSlotSelect = (s: Slot) => {
    setSelectedSlot(s);
    goTo(6);
  };

  // Step 6 → Step 7
  const handleCustomerNext = () => {
    if (customerName.trim().length < 2) { setError('الاسم مطلوب (حرفان على الأقل)'); return; }
    if (!/^[0-9]{10,15}$/.test(customerPhone.replace(/\s/g, ''))) { setError('رقم الهاتف غير صالح (10-15 رقم)'); return; }
    setError(null);
    goTo(7);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (submitGuard.current) return;
    if (!selectedService || !selectedDay || !selectedSlot) return;

    submitGuard.current = true;
    setSubmitting(true);
    setError(null);

    const resolvedEmpId =
      mode === 'nearest'
        ? selectedSlot.empId
        : selectedSlot.empId ?? selectedBarber?.id;

    const payload = {
      customer: { name: customerName.trim(), phone: customerPhone.replace(/\s/g, '') },
      serviceIds: [selectedService.id],
      date: selectedDay.date,
      time: selectedSlot.time,
      dayOffset: selectedSlot.dayOffset ?? 0,
      mode,
      empId: resolvedEmpId,
      notes: notes.trim() || undefined,
      source: 'admin',
    };

    try {
      const res = await fetch('/api/public/booking/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        const code = data.bookingCodes?.[0];
        onSuccess(code);
        onClose();
      } else if (res.status === 409) {
        setError(data.error ?? 'المعاد لم يعد متاحًا، اختر ميعادًا آخر');
        console.log('[CreateBookingModal] 409 response:', data);
        submitGuard.current = false;
      } else {
        setError(data.error ?? 'فشل إنشاء الحجز');
        console.log('[CreateBookingModal] error response:', data);
        submitGuard.current = false;
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
      submitGuard.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  // ── Back navigation ───────────────────────────────────────────────────────
  const handleBack = () => {
    setError(null);
    if (step === 2) { goTo(1); }
    else if (step === 3) { goTo(mode === 'specific' ? 2 : 1); }
    else if (step === 4) { goTo(3); }
    else if (step === 5) { goTo(4); }
    else if (step === 6) { goTo(5); }
    else if (step === 7) { goTo(6); }
  };

  if (!open) return null;

  // ── Resolved barber name for summary ─────────────────────────────────────
  const resolvedBarberName =
    mode === 'nearest'
      ? (selectedSlot?.barberName ?? '—')
      : (selectedBarber?.name ?? '—');

  const totalSteps = mode === 'nearest' ? 6 : 7;
  const currentStepNum =
    mode === 'nearest'
      ? step === 1 ? 1 : step <= 3 ? step - 1 : step - 1
      : step;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
              <CalendarDays className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-sm">حجز جديد</h2>
              <p className="text-gray-400 text-xs">{stepTitle(step, mode)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step dots */}
            <div className="flex gap-1">
              {Array.from({ length: mode === 'nearest' ? 6 : 7 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i < currentStepNum ? 'bg-blue-500' : i === currentStepNum - 1 ? 'bg-blue-400' : 'bg-gray-600'
                  }`}
                />
              ))}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-start gap-2 bg-red-900/40 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Step 1: Mode ── */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-gray-300 text-sm mb-4">اختر طريقة الحجز:</p>
              {([
                { value: 'nearest', icon: Users,     title: 'أقرب حلاق متاح',    desc: 'يتم اختيار الحلاق المتاح تلقائيًا' },
                { value: 'specific', icon: UserCheck, title: 'اختيار حلاق محدد', desc: 'اختار الحلاق الذي تريده' },
              ] as const).map(({ value, icon: Icon, title, desc }) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-right ${
                    mode === value
                      ? 'border-blue-500 bg-blue-600/10 text-white'
                      : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${mode === value ? 'bg-blue-600/20' : 'bg-gray-700'}`}>
                    <Icon className={`w-5 h-5 ${mode === value ? 'text-blue-400' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ── Step 2: Barber (specific only) ── */}
          {step === 2 && (
            <div>
              {loadingBarbers ? (
                <CenteredSpinner label="جاري تحميل الحلاقين..." />
              ) : barbers.length === 0 ? (
                <EmptyState label="لا يوجد حلاقون متاحون" />
              ) : (
                <div className="space-y-2">
                  {barbers.map(b => (
                    <button
                      key={b.id}
                      onClick={() => handleBarberSelect(b)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-700 bg-gray-800/50 hover:border-blue-500/60 hover:bg-blue-600/5 transition-all text-right"
                    >
                      <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-gray-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{b.name}</p>
                        <p className="text-gray-400 text-xs">{b.job}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Service ── */}
          {step === 3 && (
            <div>
              {loadingServices ? (
                <CenteredSpinner label="جاري تحميل الخدمات..." />
              ) : services.length === 0 ? (
                <EmptyState label="لا توجد خدمات متاحة" />
              ) : (
                <div className="space-y-2">
                  {services.map(s => (
                    <button
                      key={s.id}
                      onClick={() => handleServiceSelect(s)}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-700 bg-gray-800/50 hover:border-blue-500/60 hover:bg-blue-600/5 transition-all text-right"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-700 flex items-center justify-center shrink-0">
                          <Scissors className="w-4 h-4 text-gray-400" />
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{s.name}</p>
                          {s.categoryName && (
                            <p className="text-gray-500 text-xs">{s.categoryName}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-blue-400 text-sm font-semibold">{s.price} ج</p>
                        <p className="text-gray-500 text-xs">{s.durationMinutes} د</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Day ── */}
          {step === 4 && (
            <div>
              {loadingDays ? (
                <CenteredSpinner label="جاري تحميل الأيام المتاحة..." />
              ) : days.length === 0 ? (
                <EmptyState label="لا توجد أيام متاحة" />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {days.map(d => (
                    <button
                      key={d.date}
                      onClick={() => handleDaySelect(d)}
                      className="flex flex-col items-center p-3 rounded-xl border border-gray-700 bg-gray-800/50 hover:border-blue-500/60 hover:bg-blue-600/5 transition-all"
                    >
                      <p className="text-white text-sm font-medium">{d.label}</p>
                      <p className="text-gray-400 text-xs mt-1">{d.date}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 5: Time Slots ── */}
          {step === 5 && (
            <div>
              {loadingSlots ? (
                <CenteredSpinner label="جاري تحميل المواعيد المتاحة..." />
              ) : slots.length === 0 ? (
                <EmptyState label="لا توجد مواعيد متاحة في هذا اليوم" />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleSlotSelect(s)}
                      className="flex flex-col items-center p-3 rounded-xl border border-gray-700 bg-gray-800/50 hover:border-blue-500/60 hover:bg-blue-600/5 transition-all"
                    >
                      <Clock className="w-3.5 h-3.5 text-gray-400 mb-1" />
                      <p className="text-white text-sm font-semibold">{fmt12(s.time)}</p>
                      {s.barberName && mode === 'nearest' && (
                        <p className="text-gray-500 text-xs mt-0.5 truncate w-full text-center">{s.barberName}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 6: Customer Info ── */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-300 text-xs mb-1.5">اسم العميل *</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="الاسم الكامل"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-xs mb-1.5">رقم الهاتف *</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="01xxxxxxxxx"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-xs mb-1.5">ملاحظات (اختياري)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="أي تعليمات إضافية..."
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                />
              </div>
            </div>
          )}

          {/* ── Step 7: Confirmation Summary ── */}
          {step === 7 && selectedService && selectedDay && selectedSlot && (
            <div className="space-y-3">
              <p className="text-gray-300 text-sm mb-3">مراجعة تفاصيل الحجز:</p>
              <SummaryRow icon={User}        label="العميل"   value={`${customerName} • ${customerPhone}`} />
              <SummaryRow icon={Scissors}    label="الخدمة"   value={`${selectedService.name}`} />
              <SummaryRow icon={UserCheck}   label="الحلاق"   value={resolvedBarberName} />
              <SummaryRow icon={CalendarDays} label="التاريخ" value={formatDateAr(selectedDay.date)} />
              <SummaryRow icon={Clock}        label="الوقت"   value={fmt12(selectedSlot.time)} />
              <div className="border-t border-gray-700 pt-3 mt-3 flex justify-between text-sm">
                <span className="text-gray-400">السعر</span>
                <span className="text-white font-semibold">{selectedService.price} ج.م</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">المدة</span>
                <span className="text-white">{selectedSlot.durationMinutes ?? selectedService.durationMinutes} دقيقة</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700 shrink-0 flex gap-2">
          {step > 1 && (
            <button
              onClick={handleBack}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 text-sm transition-colors disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4" />
              رجوع
            </button>
          )}

          <div className="flex-1" />

          {/* Step-specific primary action */}
          {step === 1 && (
            <button
              onClick={handleModeConfirm}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              التالي
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          {step === 6 && (
            <button
              onClick={handleCustomerNext}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
            >
              مراجعة الحجز
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          {step === 7 && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحجز...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> تأكيد الحجز</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Loader2 className="w-7 h-7 text-blue-400 animate-spin" />
      <p className="text-gray-400 text-sm">{label}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <CalendarDays className="w-8 h-8 text-gray-600" />
      <p className="text-gray-400 text-sm">{label}</p>
    </div>
  );
}

function SummaryRow({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
      <span className="text-gray-400 text-xs w-16 shrink-0">{label}</span>
      <span className="text-white text-sm">{value}</span>
    </div>
  );
}

function stepTitle(step: Step, mode: BookingMode): string {
  const titles: Record<Step, string> = {
    1: 'طريقة الحجز',
    2: mode === 'specific' ? 'اختيار الحلاق' : 'اختيار الخدمة',
    3: mode === 'specific' ? 'اختيار الخدمة' : 'اختيار اليوم',
    4: mode === 'specific' ? 'اختيار اليوم' : 'اختيار الوقت',
    5: mode === 'specific' ? 'اختيار الوقت' : 'بيانات العميل',
    6: mode === 'specific' ? 'بيانات العميل' : 'تأكيد الحجز',
    7: 'تأكيد الحجز',
  };
  return titles[step];
}
