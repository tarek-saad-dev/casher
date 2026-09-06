'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X, User, Loader2, CheckCircle2, Clock, Users, ArrowRight, ArrowLeft,
  Search, UserPlus, CheckCircle,
} from 'lucide-react';
import type { Customer } from '@/lib/types';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import { PrintQueueTicketModal } from './PrintQueueTicketModal';
import { OpsServicePicker } from './OpsServicePicker';
import { OpsFlowErrorBanner } from './OpsFlowErrorBanner';
import { OpsFlowStepTabs } from './OpsFlowStepTabs';
import { OpsSelectedContextCard, OpsWalkInHint } from './OpsSelectedContextCard';
import { useOpsModalChrome } from './useOpsModalChrome';
import { notifyBookingV2QueueCreated } from '@/lib/operations/bookingV2/mutationSync';
import { useOpsQueueCatalog } from '@/lib/operations/useOpsQueueCatalog';
import { isOpsMainServiceName } from '@/lib/operations/opsPopularServices';
import { useSession } from '@/hooks/useSession';
import { BORDER, GOLD, GOLD_BDR } from './booking-workspace/types';

interface Service {
  ProID: number;
  ProName: string;
  DurationMinutes: number | null;
  SPrice?: number;
  CatName?: string | null;
  CatID?: string | number | null;
  ProNameEn?: string | null;
}

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
  branchId?: number;
}

interface SimulateResult {
  ok: boolean;
  decision: 'start_now' | 'after_queue' | 'after_booking' | 'outside_hours' | 'no_gap_found';
  empId: number;
  empName: string;
  serviceDurationMinutes: number;
  suggestedStartTime: string;
  suggestedEndTime: string;
  peopleBefore: number;
  message: string;
  timeline: Array<{
    type: 'queue' | 'booking' | 'gap';
    label: string;
    startTime: string;
    endTime: string;
    status: string;
  }>;
}

interface CreateResult extends CreateQueueResponse {
  error?: string;
  newSuggestion?: SimulateResult;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  barbers: Barber[];
  debugInfo?: { source: string; count: number; timestamp: string };
}

type Step = 1 | 2 | 3;

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'الخدمات' },
  { id: 2, label: 'الحلاق' },
  { id: 3, label: 'التأكيد' },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

/**
 * Phase D general queue: Services → Barber (+ plan) → Confirm.
 * Domain endpoints unchanged: simulate + create.
 */
export function SimpleCreateQueueDrawer({ isOpen, onClose, onCreated, barbers }: Props) {
  const { user, activeBranch } = useSession();
  const branchCode =
    user?.ActiveBranchCode
    ?? activeBranch?.branchCode
    ?? null;
  const { services, loading: loadingServices } = useOpsQueueCatalog(branchCode);

  const [step, setStep] = useState<Step>(1);
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [simulateResult, setSimulateResult] = useState<SimulateResult | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showCustomerFields, setShowCustomerFields] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [customerFound, setCustomerFound] = useState<boolean | null>(null);

  const customerDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const createPendingRef = useRef(false);
  const { dialogRef } = useOpsModalChrome({
    open: isOpen,
    onClose,
    allowEscape: !loading,
  });

  const workingBarbers = useMemo(
    () => barbers.filter((b) => b.status === 'working'),
    [barbers],
  );

  const totalDuration = selectedServices.reduce(
    (s, svc) => s + (svc.DurationMinutes ?? 30),
    0,
  );
  const totalPrice = selectedServices.reduce((s, svc) => s + (svc.SPrice ?? 0), 0);
  const serviceIds = useMemo(() => selectedServices.map((s) => s.ProID), [selectedServices]);

  const handleMainSelect = (proId: number) => {
    const svc = services.find((s) => s.ProID === proId);
    if (!svc) return;
    setSelectedServices((prev) => {
      const alreadyMain = prev.some((s) => s.ProID === proId && isOpsMainServiceName(s.ProName));
      const addons = prev.filter((s) => !isOpsMainServiceName(s.ProName));
      if (alreadyMain) return addons;
      return [svc, ...addons];
    });
    setSimulateResult(null);
  };

  const handleToggleAddon = (proId: number) => {
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.ProID === proId);
      if (exists) return prev.filter((s) => s.ProID !== proId);
      const svc = services.find((s) => s.ProID === proId);
      return svc ? [...prev, svc] : prev;
    });
    setSimulateResult(null);
  };

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedBarber(null);
      setSelectedServices([]);
      setSimulateResult(null);
      setCreateResult(null);
      setError(null);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerId(null);
      setCustomerFound(null);
      setCustomerSearchError(null);
      setShowCustomerFields(false);
      createPendingRef.current = false;
    }
  }, [isOpen]);

  const runSimulate = useCallback(async (barber: Barber, servicesForPlan: Service[]) => {
    if (!servicesForPlan.length) return;

    setLoading(true);
    setError(null);
    setSimulateResult(null);

    const browserNow = new Date();
    const ids = servicesForPlan.map((s) => s.ProID);
    const duration = servicesForPlan.reduce((s, svc) => s + (svc.DurationMinutes ?? 30), 0);
    const simulatePayload = {
      empId: barber.empId,
      serviceIds: ids,
      requestedAt: browserNow.toISOString(),
      ...(barber.branchId != null ? { branchId: barber.branchId } : {}),
    };

    try {
      const res = await fetch('/api/operations/queue/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simulatePayload),
      });
      const result: SimulateResult = await res.json();
      setSimulateResult(result);
      if (result.decision === 'outside_hours') {
        setError('الصنايعي خارج مواعيد العمل');
      } else if (result.decision === 'no_gap_found') {
        setError(`لا توجد فترة متصلة مدتها ${duration} دقيقة مع ${barber.empName}`);
      } else {
        setStep(3);
      }
    } catch {
      setError('فشل في حساب الوقت المتوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  const searchCustomerByPhone = useCallback(async (phone: string) => {
    if (!phone || phone.length < 7) {
      setCustomerFound(null);
      setCustomerSearchError(null);
      return;
    }

    setIsSearchingCustomer(true);
    setCustomerSearchError(null);

    try {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(phone)}`);
      if (!res.ok) throw new Error('فشل البحث');
      const data: Customer[] = await res.json();
      const matched = data.find((c) =>
        c.Mobile === phone || c.Mobile?.includes(phone),
      );
      if (matched) {
        setCustomerId(matched.ClientID);
        setCustomerName(matched.Name);
        setCustomerFound(true);
      } else {
        setCustomerId(null);
        setCustomerFound(false);
      }
    } catch {
      setCustomerSearchError('تعذر البحث عن العميل، يمكنك المتابعة يدويًا');
      setCustomerFound(null);
    } finally {
      setIsSearchingCustomer(false);
    }
  }, []);

  const handlePhoneChange = (value: string) => {
    setCustomerPhone(value);
    if (customerDebounceRef.current) clearTimeout(customerDebounceRef.current);
    if (!value.trim()) {
      setCustomerId(null);
      setCustomerFound(null);
      setCustomerSearchError(null);
      return;
    }
    customerDebounceRef.current = setTimeout(() => {
      searchCustomerByPhone(value.trim());
    }, 500);
  };

  const handleCreate = async () => {
    if (!simulateResult || !selectedBarber || !selectedServices.length) return;
    if (createPendingRef.current) return;
    createPendingRef.current = true;

    setLoading(true);
    setError(null);

    try {
      const createPayload = {
        empId: selectedBarber.empId,
        serviceIds: selectedServices.map((s) => s.ProID),
        customer: {
          clientId: customerId || undefined,
          name: customerName.trim() || (customerId ? undefined : 'عميل مباشر'),
          phone: customerPhone.trim() || undefined,
        },
        expectedStartTime: simulateResult.suggestedStartTime,
        expectedEndTime: simulateResult.suggestedEndTime,
        source: 'walk_in',
        ...(selectedBarber.branchId != null ? { branchId: selectedBarber.branchId } : {}),
      };

      const res = await fetch('/api/operations/queue/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPayload),
      });

      const result: CreateResult = await res.json();

      if (!result.ok) {
        if (res.status === 409 && result.newSuggestion) {
          setSimulateResult(result.newSuggestion);
          setError('تم تحديث الوقت - الرجاء مراجعة الاقتراح الجديد');
        } else {
          setError(result.error || 'فشل في إنشاء الدور');
        }
        return;
      }

      setCreateResult(result);
      notifyBookingV2QueueCreated({
        employeeId: selectedBarber.empId,
        businessDate: simulateResult.suggestedStartTime.slice(0, 10),
        startIso: simulateResult.suggestedStartTime,
        endIso: simulateResult.suggestedEndTime,
      });
      setShowPrintModal(true);
    } catch {
      setError('فشل في إنشاء الدور');
    } finally {
      createPendingRef.current = false;
      setLoading(false);
    }
  };

  const handleBack = () => {
    setError(null);
    if (step === 3) {
      setStep(2);
      setSimulateResult(null);
    } else if (step === 2) {
      setStep(1);
      setSelectedBarber(null);
    }
  };

  const pickBarber = (barber: Barber) => {
    setSelectedBarber(barber);
    void runSimulate(barber, selectedServices);
  };

  if (!isOpen) return null;

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
          aria-labelledby="simple-queue-title"
          tabIndex={-1}
          className="flex flex-col w-full border shadow-2xl overflow-hidden min-h-0 outline-none h-[100dvh] sm:h-[min(90vh,820px)] sm:w-[min(92vw,720px)] sm:max-w-[720px] sm:rounded-2xl"
          style={{ background: 'var(--surface-elevated)', borderColor: BORDER }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="shrink-0 border-b px-4 py-3 sm:px-5" style={{ borderColor: BORDER }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="simple-queue-title" className="text-lg font-bold text-foreground">إنشاء دور</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  خدمة ← حلاق ← تأكيد · العميل اختياري (عميل مباشر)
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 min-h-[44px] min-w-[44px] rounded-lg text-muted-foreground hover:bg-surface-muted"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <OpsFlowStepTabs steps={STEPS} step={step} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
            {error && <OpsFlowErrorBanner message={error} />}

            {step === 1 && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold">اختر الخدمات</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">الأكثر طلبًا أولاً</p>
                  </div>
                  {selectedServices.length > 0 && (
                    <p className="text-sm font-bold" style={{ color: GOLD }}>
                      {totalDuration} د · {totalPrice} ج.م
                    </p>
                  )}
                </div>
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
              <div className="space-y-3">
                <div
                  className="rounded-xl border p-3 text-sm"
                  style={{ borderColor: GOLD_BDR, background: 'color-mix(in srgb, var(--primary) 6%, transparent)' }}
                >
                  <p className="font-semibold">{selectedServices.map((s) => s.ProName).join(' + ')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{totalDuration} دقيقة · {totalPrice} ج.م</p>
                </div>
                <h3 className="text-base font-bold">اختر الحلاق</h3>
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>جاري حساب الوقت المتوقع...</span>
                  </div>
                ) : workingBarbers.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    لا يوجد صنايعية متاحين للعمل
                  </div>
                ) : (
                  workingBarbers.map((barber) => (
                    <button
                      key={barber.empId}
                      type="button"
                      onClick={() => pickBarber(barber)}
                      className="w-full p-4 rounded-xl border text-right transition-colors hover:bg-surface-muted min-h-[64px]"
                      style={{
                        borderColor: selectedBarber?.empId === barber.empId ? GOLD : BORDER,
                        background: selectedBarber?.empId === barber.empId
                          ? 'color-mix(in srgb, var(--primary) 8%, transparent)'
                          : 'var(--surface)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }}
                          >
                            <User className="w-5 h-5" style={{ color: GOLD }} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{barber.empName}</div>
                            {barber.waitingCount > 0 && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Users className="w-3.5 h-3.5" />
                                {barber.waitingCount} في الانتظار
                              </div>
                            )}
                          </div>
                        </div>
                        {barber.nextAvailableAt && (
                          <div className="text-xs font-semibold shrink-0 flex items-center gap-1" style={{ color: GOLD }}>
                            <Clock className="w-3.5 h-3.5" />
                            {formatTime(barber.nextAvailableAt)}
                          </div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {step === 3 && simulateResult && selectedBarber && selectedServices.length > 0 && (
              <div className="space-y-4">
                {createResult ? (
                  <div className="p-4 rounded-xl border text-center" style={{ borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)', background: 'color-mix(in srgb, var(--success) 8%, transparent)' }}>
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" />
                    <div className="text-lg font-bold mb-1">تم إنشاء الدور بنجاح</div>
                    <div className="text-2xl font-bold mb-2" style={{ color: GOLD }}>{createResult.ticketCode}</div>
                    <div className="text-sm text-muted-foreground">
                      وقت الدخول: {formatTime(createResult.estimatedStartTime)}
                    </div>
                  </div>
                ) : (
                  <>
                    <OpsSelectedContextCard
                      title={`الدور المتوقع مع ${selectedBarber.empName}`}
                      lines={[
                        `دخول ${formatTime(simulateResult.suggestedStartTime)} · انتهاء ${formatTime(simulateResult.suggestedEndTime)}`,
                        selectedServices.map((s) => s.ProName).join(' + '),
                        simulateResult.peopleBefore === 0
                          ? 'يمكنه الدخول الآن'
                          : simulateResult.peopleBefore === 1
                            ? 'الدور الثاني · شخص واحد قبله'
                            : `الدور رقم ${simulateResult.peopleBefore + 1} · ${simulateResult.peopleBefore} قبله`,
                        simulateResult.decision === 'start_now'
                          ? 'متاح فورًا'
                          : simulateResult.decision === 'after_queue'
                            ? 'بعد الأدوار الحالية'
                            : simulateResult.decision === 'after_booking'
                              ? 'بعد الحجز القادم للحفاظ على الموعد'
                              : null,
                      ]}
                    />

                    <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">العميل</span>
                          <span className="text-xs text-muted-foreground">— عميل مباشر افتراضيًا</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowCustomerFields((v) => !v)}
                          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border min-h-[36px]"
                          style={{ borderColor: BORDER, color: GOLD }}
                        >
                          {showCustomerFields ? 'إخفاء' : 'إضافة بيانات العميل'}
                        </button>
                      </div>

                      {!showCustomerFields && <OpsWalkInHint />}
                      {showCustomerFields && <OpsWalkInHint expanded />}

                      {showCustomerFields && (
                        <div className="space-y-3 mt-3">
                          <div className="relative">
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">رقم الهاتف</label>
                            <div className="relative">
                              <input
                                type="tel"
                                placeholder="01xxxxxxxxx"
                                value={customerPhone}
                                onChange={(e) => handlePhoneChange(e.target.value)}
                                className="w-full min-h-[44px] p-3 border rounded-lg text-right bg-transparent"
                                style={{ borderColor: BORDER }}
                                dir="ltr"
                                autoFocus
                              />
                              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                {isSearchingCustomer ? (
                                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
                                ) : customerFound === true ? (
                                  <CheckCircle className="w-4 h-4 text-success" />
                                ) : (
                                  <Search className="w-4 h-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                            {customerFound === true && (
                              <p className="text-xs text-success mt-1.5 flex items-center gap-1">
                                <CheckCircle className="w-3.5 h-3.5" /> عميل موجود
                              </p>
                            )}
                            {customerFound === false && customerPhone.length >= 7 && (
                              <p className="text-xs text-warning mt-1.5 flex items-center gap-1">
                                <UserPlus className="w-3.5 h-3.5" /> عميل جديد
                              </p>
                            )}
                            {customerSearchError && (
                              <p className="text-xs text-destructive mt-1.5">{customerSearchError}</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">اسم العميل</label>
                            <input
                              type="text"
                              placeholder="اسم العميل"
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                              className="w-full min-h-[44px] p-3 border rounded-lg text-right bg-transparent"
                              style={{ borderColor: BORDER }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div
            className="shrink-0 border-t px-4 py-3 sm:px-5 flex items-center justify-between gap-2"
            style={{ borderColor: BORDER }}
          >
            <button
              type="button"
              onClick={step > 1 && !createResult ? handleBack : onClose}
              disabled={loading}
              className="flex items-center gap-1 px-4 min-h-[48px] rounded-xl border text-sm font-semibold disabled:opacity-40"
              style={{ borderColor: BORDER }}
            >
              <ArrowRight className="w-4 h-4" />
              {step > 1 && !createResult ? 'رجوع' : 'إلغاء'}
            </button>

            <div className="flex flex-col items-end gap-1">
              {step === 1 && !selectedServices.length && (
                <p className="text-xs text-muted-foreground">اختر خدمة واحدة على الأقل</p>
              )}
              {step === 2 && !loading && (
                <p className="text-xs text-muted-foreground">اختر حلاقًا لحساب الوقت</p>
              )}
              {step === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedServices.length) {
                      setError('اختر خدمة واحدة على الأقل');
                      return;
                    }
                    setError(null);
                    setStep(2);
                  }}
                  disabled={!selectedServices.length}
                  className="flex items-center gap-1 px-5 min-h-[48px] rounded-xl text-sm font-bold text-primary-foreground disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, var(--primary-active))` }}
                >
                  التالي
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              {step === 3 && !createResult && (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={loading || !simulateResult}
                  aria-busy={loading}
                  className="flex items-center gap-2 px-5 min-h-[48px] rounded-xl text-sm font-bold text-primary-foreground disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg, ${GOLD}, var(--primary-active))` }}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
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
        onClose={() => {
          setShowPrintModal(false);
          onCreated();
          onClose();
        }}
        onPrintComplete={() => {
          onCreated();
        }}
      />
    </>
  );
}
