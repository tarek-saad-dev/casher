'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type DaySummary = {
  dayOfWeek: number;
  dayNameAr: string;
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
};

type RosterEmp = {
  empId: number;
  empName: string;
  gleemDays: DaySummary[];
  gleemHoursSummary: string;
  gleemServicesSummary: string;
  gleemPayrollSummary: string;
  gleemTargetSummary: string;
  campCaesarAssigned: boolean;
  campCaesarCanReceiveBookings: boolean;
  campCaesarCanOperate: boolean;
  campCaesarPayrollSummary: string | null;
  campCaesarTargetSummary: string | null;
  campCaesarScheduleSummary: string | null;
  campCaesarServicesSummary: string | null;
  readinessStatus: string;
  readinessNotes: string[];
};

type ServiceRow = { proId: number; proName: string; price: number; durationMinutes: number };

type LocChoice = 'GLEEM' | 'CAMP_CAESAR' | 'OFF';

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const CC_HOURS = { start: '11:00', end: '01:30' };

const emptyLoc = (): LocChoice[] => Array.from({ length: 7 }, () => 'OFF');

export default function SetupEmployeesPage() {
  const params = useParams<{ id: string }>();
  const branchId = params.id;
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<RosterEmp[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [wizardEmp, setWizardEmp] = useState<RosterEmp | null>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Wizard state
  const [effectiveFrom, setEffectiveFrom] = useState('2026-07-27');
  const [canOperate, setCanOperate] = useState(true);
  const [canReceiveBookings, setCanReceiveBookings] = useState(true);
  const [locations, setLocations] = useState<LocChoice[]>(emptyLoc);
  const [useBranchHours, setUseBranchHours] = useState(true);
  const [customStart, setCustomStart] = useState(CC_HOURS.start);
  const [customEnd, setCustomEnd] = useState(CC_HOURS.end);
  const [selectedServices, setSelectedServices] = useState<number[]>([]);
  const [servicesConfirmed, setServicesConfirmed] = useState(false);
  const [payType, setPayType] = useState<'hourly' | 'daily' | 'monthly'>('hourly');
  const [hourlyRate, setHourlyRate] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [payFrom, setPayFrom] = useState('2026-07-27');
  const [targetPolicy, setTargetPolicy] = useState<'TARGET_PLAN' | 'NO_TARGET' | ''>('');
  const [targetPlanId, setTargetPlanId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/setup/employees`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحميل');
      setEmployees(data.employees || []);
      setServices(data.services || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openWizard = (emp: RosterEmp) => {
    setWizardEmp(emp);
    setStep(1);
    setMessage(null);
    setError(null);
    setEffectiveFrom('2026-07-27');
    setCanOperate(true);
    setCanReceiveBookings(true);
    const locs = emptyLoc();
    for (const d of emp.gleemDays) {
      locs[d.dayOfWeek] = d.isWorking ? 'GLEEM' : 'OFF';
    }
    setLocations(locs);
    setUseBranchHours(true);
    setCustomStart(CC_HOURS.start);
    setCustomEnd(CC_HOURS.end);
    setSelectedServices(services.map((s) => s.proId));
    setServicesConfirmed(false);
    setPayType('hourly');
    setHourlyRate('');
    setDailyRate('');
    setMonthlySalary('');
    setPayFrom('2026-07-27');
    setTargetPolicy('');
    setTargetPlanId('');
  };

  const closeWizard = () => {
    setWizardEmp(null);
    setStep(1);
  };

  const ccWorkingDays = useMemo(
    () => locations.map((loc, i) => (loc === 'CAMP_CAESAR' ? i : -1)).filter((i) => i >= 0),
    [locations],
  );

  const buildSchedule = () => {
    const start = useBranchHours ? CC_HOURS.start : customStart;
    const end = useBranchHours ? CC_HOURS.end : customEnd;
    return locations.map((loc, dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: loc === 'CAMP_CAESAR',
      startTime: loc === 'CAMP_CAESAR' ? start : null,
      endTime: loc === 'CAMP_CAESAR' ? end : null,
    }));
  };

  const commit = async () => {
    if (!wizardEmp) return;
    if (!servicesConfirmed) {
      setError('يجب تأكيد أهلية الخدمات صراحة قبل الحفظ');
      return;
    }
    if (!targetPolicy) {
      setError('يجب اختيار سياسة التارجت صراحة');
      return;
    }
    if (ccWorkingDays.length === 0) {
      setError('يجب اختيار يوم عمل واحد على الأقل في كامب شيزار');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        action: 'assign',
        empId: wizardEmp.empId,
        effectiveFrom,
        canOperate,
        canReceiveBookings,
        schedule: buildSchedule(),
        serviceProIds: selectedServices,
        payroll: {
          payType,
          hourlyRate: payType === 'hourly' ? Number(hourlyRate) : null,
          dailyRate: payType === 'daily' ? Number(dailyRate) : null,
          monthlySalary: payType === 'monthly' ? Number(monthlySalary) : null,
          effectiveFrom: payFrom,
        },
        target:
          targetPolicy === 'NO_TARGET'
            ? { policy: 'NO_TARGET', notes: 'NO_TARGET — إطلاق كامب شيزار' }
            : { policy: 'TARGET_PLAN', targetPlanId: Number(targetPlanId) },
      };
      const res = await fetch(`/api/admin/branches/${branchId}/setup/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.code || 'فشل الحفظ');
      setMessage(`تم تعيين ${wizardEmp.empName} بنجاح (تعيين #${data.assignmentId})`);
      closeWizard();
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  const removeEmp = async (emp: RosterEmp) => {
    if (!confirm(`إزالة ${emp.empName} من فريق افتتاح كامب شيزار؟`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/branches/${branchId}/setup/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', empId: emp.empId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الإزالة');
      setMessage(`تمت إزالة ${emp.empName}`);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6" dir="rtl">
      <Link href={`/admin/branches/${branchId}/setup`} className="text-sm text-muted-foreground">
        ← معالج الإعداد
      </Link>
      <PageHeader
        title="تجهيز فريق افتتاح كامب شيزار"
        description="تعيين ذري عبر commitEmployeeBranchAssignment — بدون نسخ صامت من جليم أو اختراع رواتب"
      />

      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      {loading ? (
        <Loader2 className="mt-8 size-6 animate-spin text-muted-foreground" />
      ) : (
        <div className="mt-6 space-y-4">
          {employees.map((emp) => (
            <div
              key={emp.empId}
              className="rounded-xl border border-border/70 bg-card/60 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{emp.empName}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">#{emp.empId}</p>
                </div>
                <span
                  className={`rounded-md border px-2 py-1 text-xs ${
                    emp.readinessStatus === 'ready'
                      ? 'border-emerald-500/40 text-emerald-300'
                      : emp.campCaesarAssigned
                        ? 'border-amber-500/40 text-amber-200'
                        : 'border-border text-muted-foreground'
                  }`}
                >
                  {emp.campCaesarAssigned
                    ? emp.readinessStatus === 'ready'
                      ? 'جاهز لكامب شيزار'
                      : 'تعيين ناقص'
                    : 'غير معيّن'}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <p>
                  <span className="text-foreground/80">أيام جليم: </span>
                  {emp.gleemHoursSummary || '—'}
                </p>
                <p>
                  <span className="text-foreground/80">راتب جليم: </span>
                  {emp.gleemPayrollSummary}
                </p>
                <p>
                  <span className="text-foreground/80">تارجت جليم: </span>
                  {emp.gleemTargetSummary}
                </p>
                <p>
                  <span className="text-foreground/80">خدمات جليم: </span>
                  {emp.gleemServicesSummary}
                </p>
                {emp.campCaesarAssigned && (
                  <>
                    <p>
                      <span className="text-foreground/80">جدول كامب شيزار: </span>
                      {emp.campCaesarScheduleSummary}
                    </p>
                    <p>
                      <span className="text-foreground/80">راتب/تارجت CC: </span>
                      {emp.campCaesarPayrollSummary} / {emp.campCaesarTargetSummary}
                    </p>
                  </>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {!emp.campCaesarAssigned ? (
                  <Button type="button" onClick={() => openWizard(emp)}>
                    إضافة إلى فريق كامب شيزار
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="secondary" onClick={() => openWizard(emp)}>
                      تعديل إعداد الفرع
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void removeEmp(emp)}
                    >
                      إزالة من فريق الافتتاح
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {wizardEmp && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl"
            dir="rtl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">تعيين: {wizardEmp.empName}</h2>
                <p className="text-xs text-muted-foreground">الخطوة {step} من 7</p>
              </div>
              <Button type="button" variant="ghost" onClick={closeWizard}>
                إغلاق
              </Button>
            </div>

            {step === 1 && (
              <div className="mt-4 space-y-3">
                <Label>تاريخ السريان</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={canOperate} onChange={(e) => setCanOperate(e.target.checked)} />
                  CanOperate — تشغيل تشغيلي
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={canReceiveBookings}
                    onChange={(e) => setCanReceiveBookings(e.target.checked)}
                  />
                  CanReceiveBookings — استقبال حجوزات
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  لكل يوم اختر موقعًا واحدًا. مرجع جليم الحالي معروض — لا يُنقل أي يوم عمل تلقائيًا.
                </p>
                {DAY_NAMES.map((name, dow) => {
                  const gleem = wizardEmp.gleemDays.find((d) => d.dayOfWeek === dow);
                  return (
                    <div key={dow} className="rounded-lg border border-border/60 p-3">
                      <div className="mb-2 flex justify-between text-sm">
                        <span className="font-medium">{name}</span>
                        <span className="text-xs text-muted-foreground">
                          جليم:{' '}
                          {gleem?.isWorking
                            ? `${gleem.startTime}-${gleem.endTime}`
                            : 'إجازة'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['GLEEM', 'CAMP_CAESAR', 'OFF'] as LocChoice[]).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className={`rounded-md border px-3 py-1.5 text-xs ${
                              locations[dow] === opt
                                ? 'border-amber-500/50 bg-amber-500/15 text-amber-100'
                                : 'border-border text-muted-foreground'
                            }`}
                            onClick={() => {
                              const next = [...locations];
                              next[dow] = opt;
                              setLocations(next);
                            }}
                          >
                            {opt === 'GLEEM' ? 'جليم' : opt === 'CAMP_CAESAR' ? 'كامب شيزار' : 'إجازة'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {step === 3 && (
              <div className="mt-4 space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={useBranchHours}
                    onChange={() => setUseBranchHours(true)}
                  />
                  ساعات فرع كامب شيزار: 11:00 → 01:30 (اليوم التالي)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={!useBranchHours}
                    onChange={() => setUseBranchHours(false)}
                  />
                  ساعات مخصصة
                </label>
                {!useBranchHours && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>من</Label>
                      <Input value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                    </div>
                    <div>
                      <Label>إلى</Label>
                      <Input value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  أيام كامب شيزار المحددة: {ccWorkingDays.map((d) => DAY_NAMES[d]).join('، ') || 'لا شيء'}
                </p>
              </div>
            )}

            {step === 4 && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  كتالوج خدمات CUT — مسودة قابلة للتعديل من أهلية جليم العامة. يلزم تأكيد صريح.
                </p>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
                  {services.map((s) => (
                    <label key={s.proId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedServices.includes(s.proId)}
                        onChange={(e) => {
                          setSelectedServices((prev) =>
                            e.target.checked
                              ? [...prev, s.proId]
                              : prev.filter((id) => id !== s.proId),
                          );
                          setServicesConfirmed(false);
                        }}
                      />
                      {s.proName} ({s.price})
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-amber-200">
                  <input
                    type="checkbox"
                    checked={servicesConfirmed}
                    onChange={(e) => setServicesConfirmed(e.target.checked)}
                  />
                  أؤكد أهلية خدمات كامب شيزار لهذه القائمة
                </label>
              </div>
            )}

            {step === 5 && (
              <div className="mt-4 space-y-3">
                <p className="rounded-lg border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground">
                  مرجع جليم فقط (لا يُنسخ تلقائيًا): {wizardEmp.gleemPayrollSummary}
                </p>
                <Label>نوع الراتب المعتمد لكامب شيزار</Label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={payType}
                  onChange={(e) => setPayType(e.target.value as typeof payType)}
                >
                  <option value="hourly">hourly</option>
                  <option value="daily">daily</option>
                  <option value="monthly">monthly</option>
                </select>
                {payType === 'hourly' && (
                  <div>
                    <Label>الأجر بالساعة</Label>
                    <Input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
                  </div>
                )}
                {payType === 'daily' && (
                  <div>
                    <Label>الأجر اليومي</Label>
                    <Input value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
                  </div>
                )}
                {payType === 'monthly' && (
                  <div>
                    <Label>الراتب الشهري</Label>
                    <Input value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} />
                  </div>
                )}
                <div>
                  <Label>سريان الخطة</Label>
                  <Input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} />
                </div>
              </div>
            )}

            {step === 6 && (
              <div className="mt-4 space-y-3">
                <p className="rounded-lg border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground">
                  مرجع جليم: {wizardEmp.gleemTargetSummary} — لا افتراض صامت لـ NO_TARGET
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={targetPolicy === 'TARGET_PLAN'}
                    onChange={() => setTargetPolicy('TARGET_PLAN')}
                  />
                  TARGET_PLAN (خطة موجودة على الفرع)
                </label>
                {targetPolicy === 'TARGET_PLAN' && (
                  <div>
                    <Label>معرف خطة التارجت</Label>
                    <Input value={targetPlanId} onChange={(e) => setTargetPlanId(e.target.value)} />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={targetPolicy === 'NO_TARGET'}
                    onChange={() => setTargetPolicy('NO_TARGET')}
                  />
                  NO_TARGET — قرار صريح بدون تارجت
                </label>
              </div>
            )}

            {step === 7 && (
              <div className="mt-4 space-y-2 text-sm">
                <p>الأيام: {ccWorkingDays.map((d) => DAY_NAMES[d]).join('، ')}</p>
                <p>
                  الساعات:{' '}
                  {useBranchHours
                    ? `${CC_HOURS.start} → ${CC_HOURS.end}`
                    : `${customStart} → ${customEnd}`}
                </p>
                <p>الخدمات: {selectedServices.length} (مؤكد: {servicesConfirmed ? 'نعم' : 'لا'})</p>
                <p>
                  الحجز: {canReceiveBookings ? 'نعم' : 'لا'} · التشغيل: {canOperate ? 'نعم' : 'لا'}
                </p>
                <p>
                  الراتب: {payType}{' '}
                  {payType === 'hourly'
                    ? hourlyRate
                    : payType === 'daily'
                      ? dailyRate
                      : monthlySalary}{' '}
                  من {payFrom}
                </p>
                <p>التارجت: {targetPolicy || '—'}</p>
                <p>السريان: {effectiveFrom}</p>
                <p className="text-xs text-muted-foreground">
                  تعارضات الحجز الحالية تُرفض على الخادم إن وُجدت عند الحفظ الذري.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={step <= 1 || saving}
                onClick={() => setStep((s) => Math.max(1, s - 1))}
              >
                السابق
              </Button>
              {step < 7 ? (
                <Button type="button" onClick={() => setStep((s) => Math.min(7, s + 1))}>
                  التالي
                </Button>
              ) : (
                <Button type="button" disabled={saving} onClick={() => void commit()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : 'حفظ التعيين الذري'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
