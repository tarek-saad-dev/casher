'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, ArrowRight, ArrowLeft, Loader2, Clock, Users, User, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { BookingServiceSelect } from './BookingServiceSelect';
import { PrintQueueTicketModal } from './PrintQueueTicketModal';
import type { CreateQueueResponse, QueuePlanForBarberResult, QueuePlanAlternative } from '@/lib/operationsQueueTypes';
import { BORDER, GOLD, GOLD_BDR, formatDateLabel } from './booking-workspace/types';
import { cn } from '@/lib/utils';

interface Service {
  ProID: number;
  ProName: string;
  SPrice: number;
  DurationMinutes: number | null;
  CatName?: string | null;
}

export interface BarberQueueWorkspaceBarber {
  empId: number;
  empName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  barber: BarberQueueWorkspaceBarber;
  operationalDate: string;
  requestedFrom?: string;
  onLoadingChange?: (empId: number | null) => void;
}

type Step = 1 | 2 | 3;

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'الخدمات' },
  { id: 2, label: 'الموعد' },
  { id: 3, label: 'تأكيد وطباعة' },
];

const MAIN_SERVICE_NAMES = [
  'Hair Cut', 'Haircut', 'Detailed Cut', 'Detail Cut', 'DetailedCut',
  'Beard Styling & Fade', 'Beard Styling', 'Beard',
  'Haircut & Beard', 'Hair & Beard', 'Hair cut & Beard', 'Hair cut + Beard', 'Hair and Beard',
  'Advanced Cut', 'Fade Cut',
];

function formatTimeIso(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Cairo',
  });
}

function slotLabel(startAt: string, endAt: string): string {
  return `${formatTimeIso(startAt)} - ${formatTimeIso(endAt)}`;
}

function isMainService(name: string): boolean {
  const norm = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ').replace(/[&+]/g, ' and ');
  return MAIN_SERVICE_NAMES.some((mn) => {
    const nmn = mn.toLowerCase().replace(/[\s_-]+/g, ' ').replace(/[&+]/g, ' and ');
    return norm === nmn || norm.includes(nmn) || nmn.includes(norm);
  });
}

export function BarberQueueWorkspaceModal({
  open,
  onClose,
  onCreated,
  barber,
  operationalDate,
  requestedFrom,
  onLoadingChange,
}: Props) {
  const [step, setStep] = useState<Step>(1);
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [plan, setPlan] = useState<QueuePlanForBarberResult | null>(null);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [planLoading, setPlanLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateQueueResponse | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const planDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const serviceIds = useMemo(() => selectedServices.map((s) => s.ProID), [selectedServices]);
  const totalDuration = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.DurationMinutes ?? 30), 0),
    [selectedServices],
  );
  const totalPrice = useMemo(
    () => selectedServices.reduce((s, svc) => s + (svc.SPrice ?? 0), 0),
    [selectedServices],
  );

  const allSlots = useMemo(() => {
    if (!plan?.available || !plan.expectedStartAt || !plan.expectedEndAt) return [];
    const primary: QueuePlanAlternative = {
      startAt: plan.expectedStartAt,
      endAt: plan.expectedEndAt,
      durationMinutes: plan.totalDurationMinutes ?? totalDuration,
    };
    return [primary, ...(plan.alternatives ?? [])];
  }, [plan, totalDuration]);

  const selectedSlot = allSlots[selectedSlotIndex] ?? allSlots[0] ?? null;

  const reset = useCallback(() => {
    setStep(1);
    setSelectedServices([]);
    setPlan(null);
    setSelectedSlotIndex(0);
    setError(null);
    setCreateResult(null);
    setShowPrintModal(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    setLoadingServices(true);
    fetch('/api/services?active=true')
      .then((r) => r.json())
      .then((d) => setServices(d.services ?? d ?? []))
      .catch(() => setError('تعذر تحميل الخدمات'))
      .finally(() => setLoadingServices(false));
  }, [open, reset]);

  const fetchPlan = useCallback(async () => {
    if (!serviceIds.length) {
      setPlan(null);
      return;
    }

    setPlanLoading(true);
    setError(null);
    onLoadingChange?.(barber.empId);

    try {
      const res = await fetch('/api/operations/queue/plan-for-barber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: barber.empId,
          serviceIds,
          date: operationalDate,
          requestedFrom: requestedFrom ?? new Date().toISOString(),
          source: 'operations_barber_header',
        }),
      });
      const result: QueuePlanForBarberResult = await res.json();

      if (!result.available) {
        setPlan(result);
        setError(result.message ?? 'لا يوجد موعد متاح');
        return;
      }

      setPlan(result);
      setSelectedSlotIndex(0);
      setError(null);
    } catch {
      setError('تعذر حساب الموعد، حاول مرة أخرى');
    } finally {
      setPlanLoading(false);
      onLoadingChange?.(null);
    }
  }, [barber.empId, serviceIds, operationalDate, requestedFrom, onLoadingChange]);

  useEffect(() => {
    if (!open || step < 2 || !serviceIds.length) return;
    if (planDebounceRef.current) clearTimeout(planDebounceRef.current);
    planDebounceRef.current = setTimeout(() => {
      void fetchPlan();
    }, 350);
    return () => {
      if (planDebounceRef.current) clearTimeout(planDebounceRef.current);
    };
  }, [open, step, serviceIds.join(','), fetchPlan]);

  const handleMainSelect = (proId: number) => {
    const svc = services.find((s) => s.ProID === proId);
    if (!svc) return;
    setSelectedServices((prev) => {
      const alreadyMain = prev.some((s) => s.ProID === proId && isMainService(s.ProName));
      const addons = prev.filter((s) => !isMainService(s.ProName));
      if (alreadyMain) return addons;
      return [svc, ...addons];
    });
    setPlan(null);
    setSelectedSlotIndex(0);
  };

  const handleToggleAddon = (proId: number) => {
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.ProID === proId);
      if (exists) return prev.filter((s) => s.ProID !== proId);
      const svc = services.find((s) => s.ProID === proId);
      return svc ? [...prev, svc] : prev;
    });
    setPlan(null);
    setSelectedSlotIndex(0);
  };

  const removeService = (proId: number) => {
    setSelectedServices((prev) => prev.filter((s) => s.ProID !== proId));
    setPlan(null);
    setSelectedSlotIndex(0);
  };

  const goNext = async () => {
    if (step === 1) {
      if (!selectedServices.length) {
        setError('اختر خدمة واحدة على الأقل');
        return;
      }
      setError(null);
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!plan?.available || !selectedSlot) {
        setError(plan?.message ?? 'لا يوجد موعد متاح');
        return;
      }
      setError(null);
      setStep(3);
    }
  };

  const goBack = () => {
    setError(null);
    if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  };

  const handleCreate = async () => {
    if (!selectedSlot || !serviceIds.length) return;

    setCreateLoading(true);
    setError(null);
    onLoadingChange?.(barber.empId);

    try {
      const res = await fetch('/api/operations/queue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: barber.empId,
          serviceIds,
          customer: { name: 'عميل مباشر' },
          expectedStartTime: selectedSlot.startAt,
          expectedEndTime: selectedSlot.endAt,
          source: 'operations_barber_header',
        }),
      });

      const result = await res.json();

      if (!result.ok) {
        if (res.status === 409) {
          setError(result.error ?? 'الفترة المختارة لم تعد متاحة، تم تحديث أقرب موعد');
          setStep(2);
          await fetchPlan();
        } else {
          setError(result.error ?? 'تعذر إنشاء الدور، حاول مرة أخرى');
        }
        return;
      }

      setCreateResult(result as CreateQueueResponse);
      onCreated();
      setShowPrintModal(true);
    } catch {
      setError('تعذر إنشاء الدور، حاول مرة أخرى');
    } finally {
      setCreateLoading(false);
      onLoadingChange?.(null);
    }
  };

  const handlePrintComplete = () => {
    setShowPrintModal(false);
    onClose();
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-0 sm:p-4"
        dir="rtl"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            'flex flex-col w-full border shadow-2xl overflow-hidden',
            'h-[100dvh] sm:h-[min(90vh,820px)] sm:w-[min(92vw,960px)] sm:max-w-[960px] sm:rounded-2xl',
          )}
          style={{ background: 'var(--surface-elevated)', borderColor: BORDER }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="shrink-0 border-b px-4 py-4 sm:px-6" style={{ borderColor: BORDER }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  من عمود {barber.empName}
                </p>
                <h2 className="text-lg font-bold text-foreground sm:text-xl">
                  إنشاء دور مع {barber.empName}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  اختر الخدمات وسيتم تحديد أقرب وقت متاح تلقائيًا
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 min-h-[44px] min-w-[44px] text-muted-foreground hover:bg-surface-muted"
                aria-label="إغلاق"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              {STEPS.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-1.5 text-center text-xs font-semibold',
                    step === s.id
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : step > s.id
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-border text-muted-foreground',
                  )}
                >
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold">اختر الخدمات</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      المدة الإجمالية تحدد أقرب موعد متاح
                    </p>
                  </div>
                  {selectedServices.length > 0 && (
                    <div
                      className="rounded-xl border px-4 py-2 text-right"
                      style={{ borderColor: GOLD_BDR, background: 'color-mix(in srgb, var(--primary) 8%, transparent)' }}
                    >
                      <p className="text-lg font-bold" style={{ color: GOLD }}>{totalDuration} دقيقة</p>
                      <p className="text-xs text-muted-foreground">{totalPrice} ج.م</p>
                    </div>
                  )}
                </div>

                {selectedServices.length > 0 && (
                  <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: BORDER }}>
                    <p className="text-xs font-bold text-muted-foreground">
                      {selectedServices.length} خدمة
                    </p>
                    <ul className="space-y-2">
                      {selectedServices.map((s) => (
                        <li key={s.ProID} className="flex items-center justify-between gap-2 text-sm">
                          <span>
                            {s.ProName} — {s.DurationMinutes ?? 30} دقيقة
                          </span>
                          <button
                            type="button"
                            onClick={() => removeService(s.ProID)}
                            className="p-2 min-h-[44px] min-w-[44px] rounded-lg hover:bg-surface-muted text-muted-foreground"
                            aria-label={`إزالة ${s.ProName}`}
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="pt-2 border-t flex justify-between text-sm font-bold" style={{ borderColor: BORDER }}>
                      <span style={{ color: GOLD }}>الإجمالي: {totalDuration} دقيقة</span>
                      <span style={{ color: GOLD }}>{totalPrice} ج.م</span>
                    </div>
                  </div>
                )}

                <BookingServiceSelect
                  services={services}
                  selectedIds={serviceIds}
                  onSelectMain={handleMainSelect}
                  onToggleAddon={handleToggleAddon}
                  isLoading={loadingServices}
                />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div
                  className="rounded-xl border p-4 space-y-2"
                  style={{ borderColor: GOLD_BDR, background: 'color-mix(in srgb, var(--primary) 6%, transparent)' }}
                >
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-primary" />
                    <span className="font-bold">{barber.empName}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{formatDateLabel(operationalDate)}</p>
                  <p className="text-sm">
                    الوقت المطلوب: <strong style={{ color: GOLD }}>{totalDuration} دقيقة</strong>
                  </p>
                </div>

                {planLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                    <span>جاري حساب أقرب موعد...</span>
                  </div>
                ) : plan?.available && allSlots.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm font-bold text-foreground">أقرب وقت متاح:</p>
                    {allSlots.map((slot, idx) => (
                      <button
                        key={`${slot.startAt}-${idx}`}
                        type="button"
                        onClick={() => setSelectedSlotIndex(idx)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-right transition-colors min-h-[48px]',
                          selectedSlotIndex === idx
                            ? 'border-primary/50 bg-primary/10'
                            : 'border-border hover:bg-surface-muted/50',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Clock className="size-4 text-primary" />
                          <span className="font-semibold">{slotLabel(slot.startAt, slot.endAt)}</span>
                        </div>
                        {idx === 0 && (
                          <span className="text-xs rounded-full bg-primary/15 px-2 py-0.5 text-primary">
                            الأقرب
                          </span>
                        )}
                      </button>
                    ))}
                    {typeof plan.waitingCountAtCreation === 'number' && plan.waitingCountAtCreation > 0 && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="size-4" />
                        <span>{plan.waitingCountAtCreation} عميل قبله</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {plan?.message ?? error ?? 'لا يوجد موعد متاح'}
                  </p>
                )}
              </div>
            )}

            {step === 3 && selectedSlot && (
              <div className="space-y-4">
                <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: BORDER }}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-5 text-success" />
                    <span className="font-bold">مراجعة الدور</span>
                  </div>
                  <div className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">الحلاق</span>
                      <span className="font-semibold">{barber.empName}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">التاريخ</span>
                      <span>{formatDateLabel(operationalDate)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">الموعد</span>
                      <span className="font-semibold" style={{ color: GOLD }}>
                        {slotLabel(selectedSlot.startAt, selectedSlot.endAt)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">المدة</span>
                      <span>{totalDuration} دقيقة</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">السعر</span>
                      <span>{totalPrice} ج.م</span>
                    </div>
                    {typeof plan?.waitingCountAtCreation === 'number' && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">عملاء قبله</span>
                        <span>{plan.waitingCountAtCreation}</span>
                      </div>
                    )}
                  </div>
                  <div className="border-t pt-3 space-y-1" style={{ borderColor: BORDER }}>
                    <p className="text-xs font-bold text-muted-foreground">الخدمات</p>
                    {selectedServices.map((s) => (
                      <p key={s.ProID} className="text-sm">
                        {s.ProName} — {s.DurationMinutes ?? 30} دقيقة
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="shrink-0 border-t px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-2"
            style={{ borderColor: BORDER }}
          >
            <div className="flex gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={createLoading}
                  className="flex items-center gap-1 rounded-xl border px-4 py-2.5 text-sm font-medium min-h-[44px] hover:bg-surface-muted"
                  style={{ borderColor: BORDER }}
                >
                  <ArrowRight className="size-4" />
                  رجوع
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                disabled={createLoading}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground min-h-[44px] hover:bg-surface-muted"
              >
                إلغاء
              </button>
            </div>

            {step < 3 ? (
              <button
                type="button"
                onClick={() => void goNext()}
                disabled={step === 1 && !selectedServices.length}
                className="flex items-center gap-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground min-h-[44px] hover:bg-primary/90 disabled:opacity-50"
              >
                التالي
                <ArrowLeft className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={createLoading || !selectedSlot}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground min-h-[44px] hover:bg-primary/90 disabled:opacity-50"
              >
                {createLoading && <Loader2 className="size-4 animate-spin" />}
                إنشاء وطباعة الدور
              </button>
            )}
          </div>
        </div>
      </div>

      <PrintQueueTicketModal
        isOpen={showPrintModal}
        ticket={createResult}
        onClose={handlePrintComplete}
        onPrintComplete={handlePrintComplete}
      />
    </>
  );
}
