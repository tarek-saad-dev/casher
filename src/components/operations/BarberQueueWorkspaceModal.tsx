'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, ArrowRight, ArrowLeft, Loader2, Clock, Users, CheckCircle2,
} from 'lucide-react';
import { OpsServicePicker } from './OpsServicePicker';
import { OpsFlowErrorBanner } from './OpsFlowErrorBanner';
import { OpsFlowStepTabs } from './OpsFlowStepTabs';
import { OpsSelectedContextCard, OpsWalkInHint } from './OpsSelectedContextCard';
import { useOpsModalChrome } from './useOpsModalChrome';
import { PrintQueueTicketModal } from './PrintQueueTicketModal';
import type { CreateQueueResponse, QueuePlanForBarberResult, QueuePlanAlternative } from '@/lib/operationsQueueTypes';
import { BORDER, GOLD, GOLD_BDR, formatDateLabel } from './booking-workspace/types';
import { notifyBookingV2QueueCreated } from '@/lib/operations/bookingV2/mutationSync';
import { isOpsMainServiceName } from '@/lib/operations/opsPopularServices';
import { useOpsQueueCatalog } from '@/lib/operations/useOpsQueueCatalog';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';

interface Service {
  ProID: number;
  ProName: string;
  SPrice: number;
  DurationMinutes: number | null;
  CatName?: string | null;
  CatID?: string | number | null;
  ProNameEn?: string | null;
}

export interface BarberQueueWorkspaceBarber {
  empId: number;
  empName: string;
  /** Operational branch for this barber (cross-branch ops without session switch). */
  branchId?: number;
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

/** Phase D — locked barber: Service → Plan+Confirm (no redundant Review). */
type Step = 1 | 2;

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'الخدمات' },
  { id: 2, label: 'التأكيد' },
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
  return isOpsMainServiceName(name);
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
  const { user, activeBranch } = useSession();
  const branchCode =
    user?.ActiveBranchCode
    ?? activeBranch?.branchCode
    ?? null;
  const { services, loading: loadingServices } = useOpsQueueCatalog(branchCode);

  const [step, setStep] = useState<Step>(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [plan, setPlan] = useState<QueuePlanForBarberResult | null>(null);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [planLoading, setPlanLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateQueueResponse | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const planDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const createPendingRef = useRef(false);
  const { dialogRef } = useOpsModalChrome({
    open,
    onClose,
    allowEscape: !createLoading,
  });

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
    createPendingRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
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
          ...(barber.branchId != null ? { branchId: barber.branchId } : {}),
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
  }, [barber.empId, barber.branchId, serviceIds, operationalDate, requestedFrom, onLoadingChange]);

  // Prefetch plan while selecting services so Confirm feels instant.
  useEffect(() => {
    if (!open || !serviceIds.length) return;
    if (planDebounceRef.current) clearTimeout(planDebounceRef.current);
    planDebounceRef.current = setTimeout(() => {
      void fetchPlan();
    }, 350);
    return () => {
      if (planDebounceRef.current) clearTimeout(planDebounceRef.current);
    };
  }, [open, serviceIds.join(','), fetchPlan]);

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

  const goNext = () => {
    if (step !== 1) return;
    if (!selectedServices.length) {
      setError('اختر خدمة واحدة على الأقل');
      return;
    }
    setError(null);
    setStep(2);
  };

  const goBack = () => {
    setError(null);
    if (step === 2) setStep(1);
  };

  const handleCreate = async () => {
    if (!selectedSlot || !serviceIds.length) return;
    if (createPendingRef.current) return;
    createPendingRef.current = true;

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
          ...(barber.branchId != null ? { branchId: barber.branchId } : {}),
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
      notifyBookingV2QueueCreated({
        employeeId: barber.empId,
        businessDate: operationalDate,
        startIso: selectedSlot.startAt,
        endIso: selectedSlot.endAt,
      });
      onCreated();
      setShowPrintModal(true);
    } catch {
      setError('تعذر إنشاء الدور، حاول مرة أخرى');
    } finally {
      createPendingRef.current = false;
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
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="barber-queue-title"
          tabIndex={-1}
          className={cn(
            'flex flex-col w-full border shadow-2xl overflow-hidden min-h-0 outline-none',
            'h-[100dvh] sm:h-[min(90vh,820px)] sm:w-[min(92vw,960px)] sm:max-w-[960px] sm:rounded-2xl',
          )}
          style={{ background: 'var(--surface-elevated)', borderColor: BORDER }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 border-b px-4 py-3 sm:px-6" style={{ borderColor: BORDER }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  من عمود {barber.empName}
                </p>
                <h2 id="barber-queue-title" className="text-lg font-bold text-foreground sm:text-xl">
                  إنشاء دور مع {barber.empName}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  اختر الخدمة — الحلاق ثابت · عميل مباشر
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

            <OpsFlowStepTabs steps={STEPS} step={step} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
            {error && <OpsFlowErrorBanner message={error} />}

            {step === 1 && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold">اختر الخدمات</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      الأكثر طلبًا أولاً — المدة تحدد أقرب وقت متاح
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
                  </div>
                )}

                <OpsServicePicker
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
                <OpsSelectedContextCard
                  title={barber.empName}
                  lines={[
                    formatDateLabel(operationalDate),
                    selectedServices.map((s) => s.ProName).join(' + '),
                    `الوقت المطلوب: ${totalDuration} دقيقة · ${totalPrice} ج.م`,
                  ]}
                  footer={<OpsWalkInHint />}
                />

                {planLoading && !selectedSlot ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="size-5 animate-spin" />
                    <span>جاري حساب أقرب وقت...</span>
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
                        <span>
                          {plan.waitingCountAtCreation === 1
                            ? 'الدور الثاني'
                            : `الدور رقم ${plan.waitingCountAtCreation + 1} · ${plan.waitingCountAtCreation} قبله`}
                        </span>
                      </div>
                    )}
                    {planLoading && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> جاري تحديث الخطة...
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {plan?.message ?? error ?? 'لا يوجد موعد متاح'}
                  </p>
                )}

                {selectedSlot && (
                  <div className="rounded-xl border p-3 text-xs text-muted-foreground" style={{ borderColor: BORDER }}>
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="size-4 text-success" />
                      <span className="font-semibold text-foreground">جاهز للإضافة للدور</span>
                    </div>
                    اضغط «إضافة للدور» لإنشاء التذكرة والطباعة.
                  </div>
                )}
              </div>
            )}
          </div>

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
                  className="flex items-center gap-1 rounded-xl border px-4 py-2.5 text-sm font-semibold min-h-[48px] hover:bg-surface-muted"
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
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground min-h-[48px] hover:bg-surface-muted"
              >
                إلغاء
              </button>
            </div>

            <div className="flex flex-col items-end gap-1">
              {step === 1 && !selectedServices.length && (
                <p className="text-xs text-muted-foreground">اختر خدمة واحدة على الأقل</p>
              )}
              {step === 2 && !selectedSlot && !planLoading && (
                <p className="text-xs text-muted-foreground">اختر وقتًا متاحًا</p>
              )}
              {step === 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!selectedServices.length}
                  className="flex items-center gap-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground min-h-[48px] hover:bg-primary/90 disabled:opacity-50"
                >
                  التالي
                  <ArrowLeft className="size-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={createLoading || !selectedSlot || planLoading}
                  aria-busy={createLoading}
                  className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground min-h-[48px] hover:bg-primary/90 disabled:opacity-50"
                >
                  {createLoading && <Loader2 className="size-4 animate-spin" />}
                  إضافة للدور
                </button>
              )}
            </div>
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
