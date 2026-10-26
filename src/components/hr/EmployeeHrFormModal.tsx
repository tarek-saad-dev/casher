'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ImageIcon,
  Loader2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DayOffPolicy, EmploymentType } from '@/lib/hr/employee-hr-model';
import {
  EMPLOYMENT_TYPE_LABELS,
  PAYROLL_METHOD_LABELS,
  DAY_OFF_POLICY_LABELS,
  FREELANCE_MONTHLY_ERROR,
} from '@/lib/hr/employee-hr-model';
import { JobType } from '@/lib/types';
import { BARBER_IMAGE_PRESETS } from '@/lib/barberImages';
import RetroPayrollAgreementReview, {
  type RetroReviewActionState,
  type RetroReviewHandle,
} from '@/components/hr/RetroPayrollAgreementReview';
import EmployeeBranchPayrollFields, {
  type CompensationBranch,
  type CompensationDetails,
  type CompensationMode,
} from '@/components/hr/EmployeeBranchPayrollFields';

const JOB_NONE_VALUE = '__none__';
const JOB_TYPE_OPTIONS = Object.values(JobType);
import {
  availablePayrollMethods,
  buildEmployeeHrApiPayload,
  buildProfileApiPayload,
  createEmptyEmployeeHrFormState,
  employeeToFormState,
  employmentTypeHelper,
  payrollMethodHelper,
  schedulePreviewText,
  validateEmployeeHrForm,
  WEEKDAY_LABELS,
  type EmployeeHrFormState,
  type HrEmployeeListRow,
} from '@/components/hr/employee-hr-form-utils';

export interface EmployeeHrFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  employee: HrEmployeeListRow | null;
  onSaved: (message: string) => void;
}

function RadioCard({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-right rounded-lg border p-3 transition-colors ${
        selected
          ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
          : 'border-border bg-surface-muted/30 hover:bg-surface-muted/60'
      }`}
    >
      <div className="font-medium text-sm text-foreground">{title}</div>
      {description && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      )}
    </button>
  );
}

export default function EmployeeHrFormModal({
  open,
  onOpenChange,
  mode,
  employee,
  onSaved,
}: EmployeeHrFormModalProps) {
  const [form, setForm] = useState<EmployeeHrFormState>(createEmptyEmployeeHrFormState);
  const [initialForm, setInitialForm] = useState<EmployeeHrFormState | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState('');
  const [compDetails, setCompDetails] = useState<CompensationDetails | null>(null);
  const [compScope, setCompScope] = useState<CompensationMode>('global');
  const [compBranches, setCompBranches] = useState<CompensationBranch[]>([]);
  const [compDate, setCompDate] = useState('');
  const [compGlobalSalary, setCompGlobalSalary] = useState('');
  const retroReviewRef = useRef<RetroReviewHandle | null>(null);
  const [retroAction, setRetroAction] = useState<RetroReviewActionState | null>(null);

  const patchForm = useCallback((partial: Partial<EmployeeHrFormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleImageFileUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setImageUploadError('');
      setUploadingImage(true);
      try {
        const body = new FormData();
        body.append('file', file);
        if (employee?.EmpID) body.append('empId', String(employee.EmpID));
        const res = await fetch('/api/admin/employees/upload-image', {
          method: 'POST',
          body,
        });
        const data = await res.json();
        if (!res.ok || !data.ok || !data.imageUrl) {
          throw new Error(data.error || 'فشل رفع الصورة');
        }
        patchForm({ imageUrl: String(data.imageUrl) });
      } catch (e: unknown) {
        setImageUploadError(e instanceof Error ? e.message : 'فشل رفع الصورة');
      } finally {
        setUploadingImage(false);
      }
    },
    [employee?.EmpID, patchForm],
  );

  const markScheduleTouched = useCallback(() => {
    setScheduleTouched(true);
  }, []);

  const loadEditData = useCallback(async (emp: HrEmployeeListRow, signal: AbortSignal) => {
    setLoadingProfile(true);
    setCompDetails(null);
    setError('');
    try {
      // Both sources are required: never offer a financial save from stale list data.
      const [profileRes, compensationRes] = await Promise.all([
        fetch(`/api/admin/employees/${emp.EmpID}/profile`, { signal }),
        fetch(`/api/admin/employees/${emp.EmpID}/compensation`, { signal }),
      ]);
      const profileData = await profileRes.json();
      const compensationData = await compensationRes.json();
      if (!profileRes.ok) throw new Error(profileData.error || 'تعذر تحميل ملف الموظف');
      if (!compensationRes.ok) throw new Error(compensationData.error || 'تعذر تحميل اتفاقيات القبض');
      if (signal.aborted) return;

      const details = compensationData as CompensationDetails;
      const next = employeeToFormState(emp, profileData.employee ?? null, profileData.schedule ?? null);
      setForm(next);
      setInitialForm(next);
      setCompDetails(details);
      setCompScope(details.employee.scope);
      setCompBranches(details.branches);
      setCompDate(details.effectiveFrom);
      setCompGlobalSalary(String(details.branches.find((b) => b.isAssigned && b.enabled)?.monthlySalary ?? ''));
      setScheduleTouched(false);
    } catch (e: unknown) {
      if (signal.aborted) return;
      setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات — أعد فتح تعديل الموظف');
    } finally {
      if (!signal.aborted) setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError('');
    setImageUploadError('');
    setOptionalOpen(false);
    setCompDetails(null);
    setCompScope('global');
    setCompBranches([]);
    setCompDate('');
    setCompGlobalSalary('');
    if (mode === 'create') {
      const empty = createEmptyEmployeeHrFormState();
      setForm(empty);
      setInitialForm(empty);
      setScheduleTouched(true);
    } else if (employee) {
      void loadEditData(employee, controller.signal);
    }
    return () => controller.abort();
  }, [open, mode, employee, loadEditData]);

  const payrollOptions = useMemo(
    () => availablePayrollMethods(form.employmentType),
    [form.employmentType],
  );

  useEffect(() => {
    if (!payrollOptions.includes(form.payrollMethod)) {
      patchForm({ payrollMethod: payrollOptions[0] });
    }
    if (form.employmentType !== 'full_time' && form.dayOffPolicy !== 'none') {
      patchForm({ dayOffPolicy: 'none' });
    }
    if (form.employmentType === 'full_time' && form.dayOffPolicy === 'none') {
      patchForm({ dayOffPolicy: 'fixed_weekly' });
    }
  }, [form.employmentType, form.payrollMethod, form.dayOffPolicy, payrollOptions, patchForm]);

  const cairoToday = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const find = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${find('year')}-${find('month')}-${find('day')}`;
  }, []);
  const isVipScope = compScope === 'branch_monthly';
  const isPersistedVip = mode === 'edit' && compDetails?.employee.scope === 'branch_monthly';
  const vipEligible = Boolean(
    compDetails?.employee.payrollEnabled &&
    form.isPayrollEnabled &&
    form.employmentType !== 'freelance',
  );
  const compensationChanged = Boolean(
    mode === 'edit' && compDetails && (
      compScope !== compDetails.employee.scope ||
      (isVipScope && (
        compDate !== compDetails.effectiveFrom ||
        JSON.stringify(compBranches.map((b) => [b.branchId, b.enabled, b.monthlySalary])) !==
          JSON.stringify(compDetails.branches.map((b) => [b.branchId, b.enabled, b.monthlySalary]))
      ))
    ),
  );
  const isRetroVip = mode === 'edit' && isVipScope &&
    compDetails?.employee.scope === 'global' &&
    compDate.slice(0, 7) === cairoToday.slice(0, 7) && compDate <= cairoToday;
  const compensationError = (() => {
    if (mode !== 'edit' || !compDetails) return null;
    if (form.employmentType === 'freelance' && (isVipScope || isPersistedVip)) {
      return 'يجب إيقاف نظام VIP أولًا قبل تحويل الموظف إلى فري لانس';
    }
    if (isVipScope && compensationChanged && !isRetroVip) {
      if (!vipEligible) return 'اتفاقية VIP تتطلب تفعيل الرواتب وموظفًا غير فري لانس.';
      const active = compBranches.filter((b) => b.enabled);
      if (!active.length) return 'فعّل مرتب فرع واحد على الأقل';
      if (active.some((b) => !b.isAssigned || !Number.isFinite(Number(b.monthlySalary)) ||
        Number(b.monthlySalary) <= 0 || Number(b.monthlySalary) > 100000000)) {
        return 'راجع تعيين الفروع وقيم المرتبات الشهرية';
      }
    }
    if (compensationChanged && !isRetroVip) {
      if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(compDate) ||
        compDate < compDetails.effectiveFrom) {
        return 'تاريخ سريان المرتب لازم يكون أول يوم من شهر قادم';
      }
      if (!isVipScope && (!(Number(compGlobalSalary) > 0) ||
        !Number.isFinite(Number(compGlobalSalary)) || Number(compGlobalSalary) > 100000000)) {
        return 'حدد المرتب الشهري العام عند العودة من VIP';
      }
    }
    return null;
  })();
  // Branch-specific salaries are controlled exclusively by the compensation endpoint.
  const preview = schedulePreviewText(form);
  const validation = validateEmployeeHrForm(
    isVipScope || isPersistedVip ? { ...form, isPayrollEnabled: false } : form,
  );
  const hasOtherUnsavedChanges = mode === 'edit' && initialForm !== null &&
    JSON.stringify(form) !== JSON.stringify(initialForm);
  const canSubmit = validation.ok && !compensationError && !isRetroVip && !saving && !loadingProfile &&
    (mode === 'create' || compDetails !== null);
  const canSubmitRetro = isRetroVip && !saving && !loadingProfile && !hasOtherUnsavedChanges &&
    Boolean(retroAction?.canApprove || retroAction?.canReview) && !retroAction?.busy;

  const onCompScopeChange = (scope: CompensationMode) => {
    if (scope === 'branch_monthly' && compDetails?.employee.scope === 'global') {
      // Never default a new financial agreement to a date in the past.
      const [year, month] = cairoToday.split('-').map(Number);
      setCompDate(new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10));
    } else if (scope === 'global' && compDetails) {
      setCompDate(compDetails.effectiveFrom);
    }
    setCompScope(scope);
  };

  const patchCompBranch = (id: number, partial: Partial<CompensationBranch>) => {
    setCompBranches((rows) => rows.map((b) => b.branchId === id ? { ...b, ...partial } : b));
  };

  const handleEmploymentTypeChange = (employmentType: EmploymentType) => {
    if (employmentType === 'freelance' && (isVipScope || isPersistedVip)) {
      setError('أوقف اتفاقية VIP أولًا، وبعد سريان العودة للنظام العام يمكن تغيير نوع التوظيف.');
      return;
    }
    markScheduleTouched();
    const payrollMethod =
      employmentType === 'freelance' && form.payrollMethod === 'monthly'
        ? 'hourly'
        : form.payrollMethod;
    patchForm({
      employmentType,
      payrollMethod,
      dayOffPolicy: employmentType === 'full_time' ? 'fixed_weekly' : 'none',
      workingDays: employmentType === 'part_time' ? form.workingDays : [],
    });
  };

  const toggleWorkingDay = (day: number) => {
    markScheduleTouched();
    setForm((prev) => {
      const set = new Set(prev.workingDays);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...prev, workingDays: Array.from(set).sort((a, b) => a - b) };
    });
  };

  const handleSubmit = async () => {
    if (mode === 'edit' && !compDetails) {
      setError('اتفاقيات القبض لم تكتمل؛ أعد فتح تعديل الموظف');
      return;
    }
    if (compensationError) {
      setError(compensationError);
      return;
    }
    const v = validation;
    if (!v.ok) {
      setError(v.error ?? 'تحقق من البيانات');
      return;
    }

    setSaving(true);
    setError('');
    let employeeDetailsSaved = false;
    try {
      const includeSchedule =
        mode === 'create'
          ? form.employmentType !== 'freelance'
          : scheduleTouched && form.employmentType !== 'freelance';

      const hrPayload = buildEmployeeHrApiPayload(form, { mode, includeSchedule });
      if (isVipScope || isPersistedVip) {
        delete hrPayload.payrollMethod;
        delete hrPayload.monthlySalary;
        delete hrPayload.manualHourlyRate;
        delete hrPayload.dailyRate;
      }

      if (mode === 'create') {
        const res = await fetch('/api/employees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hrPayload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'خطأ في إنشاء الموظف');

        const empId = data.EmpID as number;
        const profilePayload = buildProfileApiPayload(form);
        if (profilePayload && empId) {
          await fetch(`/api/admin/employees/${empId}/profile`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profilePayload),
          });
        }

        onSaved(`تم إضافة الموظف "${form.empName.trim()}" بنجاح`);
        onOpenChange(false);
        return;
      }

      if (!employee) throw new Error('الموظف غير محدد');

      const res = await fetch(`/api/employees/${employee.EmpID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hrPayload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في تحديث الموظف');

      const profilePayload = buildProfileApiPayload(form);
      if (profilePayload) {
        const profileRes = await fetch(`/api/admin/employees/${employee.EmpID}/profile`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profilePayload),
        });
        const profileData = await profileRes.json();
        if (!profileRes.ok) {
          throw new Error(profileData.error || 'تم حفظ HR لكن فشل حفظ البيانات الإضافية');
        }
      }

      employeeDetailsSaved = true;

      if (compensationChanged) {
        const compRes = await fetch(`/api/admin/employees/${employee.EmpID}/compensation`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: compScope,
            effectiveFrom: compDate,
            globalMonthlySalary: Number(compGlobalSalary),
            branches: compBranches.map((b) => ({
              branchId: b.branchId,
              enabled: b.enabled,
              monthlySalary: Number(b.monthlySalary) || 0,
            })),
          }),
        });
        const compData = await compRes.json();
        if (!compRes.ok) throw new Error(compData.error || 'تعذر حفظ اتفاقيات القبض');
      }

      onSaved(`تم تحديث ملف "${form.empName.trim()}"${compensationChanged ? ' واتفاقيات القبض' : ''} بنجاح`);
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'خطأ غير متوقع';
      setError(employeeDetailsSaved
        ? `تم حفظ بيانات الموظف العامة، لكن فشل حفظ اتفاقيات القبض: ${message}. راجع الاتفاقية قبل إعادة المحاولة.`
        : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'create' ? (
              <>
                <UserPlus className="w-5 h-5 text-primary" />
                إضافة موظف جديد
              </>
            ) : (
              <>
                <Users className="w-5 h-5 text-primary" />
                تعديل ملف الموظف
                {employee?.EmpName ? ` — ${employee.EmpName}` : ''}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {loadingProfile && mode === 'edit' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل بيانات الموظف...
          </div>
        )}

        {mode === 'create' && (
          <div className="rounded-lg border border-border/50 bg-surface-muted/40 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground text-sm mb-2">ما سيحدث تلقائياً عند الإضافة:</p>
            <p>• إنشاء الموظف مع بيانات HR المحددة</p>
            <p>• إنشاء/ربط بند سلفة: <span className="font-mono text-primary">سلفه ( اسم الموظف )</span></p>
          </div>
        )}

        <div className="space-y-6 pt-2">
          {/* SECTION 1 */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2">
              ١ — البيانات الأساسية
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>اسم الموظف (عربي) *</Label>
                <Input
                  value={form.empName}
                  onChange={(e) => patchForm({ empName: e.target.value })}
                  placeholder="مثال: محمد"
                />
              </div>
              <div className="space-y-1.5">
                <Label>اسم الموظف (إنجليزي)</Label>
                <Input
                  value={form.empNameEn}
                  onChange={(e) => patchForm({ empNameEn: e.target.value })}
                  placeholder="Example: Mohamed"
                  dir="ltr"
                />
                <p className="text-[11px] text-muted-foreground">
                  يظهر في موقع الحجز بالإنجليزية (`nameEn` في الـ API)
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>ترتيب الظهور في موقع الحجز</Label>
                <Input
                  type="number"
                  min={0}
                  max={999999}
                  step={1}
                  value={form.displaySortOrder}
                  onChange={(e) => patchForm({ displaySortOrder: e.target.value })}
                  dir="ltr"
                  placeholder="10"
                />
                <p className="text-[11px] text-muted-foreground">
                  الرقم الأصغر يظهر أولاً في قائمة الحلاقين للعميل (مثلاً 10 ثم 20 ثم 30)
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>تاريخ بداية العمل</Label>
                <Input
                  type="date"
                  value={form.hireDate}
                  onChange={(e) => patchForm({ hireDate: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <Label className="text-sm">الحالة</Label>
                  <p className="text-xs text-muted-foreground">
                    {form.isActive ? 'نشط' : 'غير نشط'}
                  </p>
                </div>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => patchForm({ isActive: v })}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label>دور الموظف</Label>
                <Select
                  value={form.job || JOB_NONE_VALUE}
                  onValueChange={(value) =>
                    patchForm({ job: value === JOB_NONE_VALUE ? '' : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر دور الموظف" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={JOB_NONE_VALUE}>بدون تحديد</SelectItem>
                    {JOB_TYPE_OPTIONS.map((job) => (
                      <SelectItem key={job} value={job}>
                        {job}
                      </SelectItem>
                    ))}
                    {form.job && !JOB_TYPE_OPTIONS.includes(form.job as JobType) && (
                      <SelectItem value={form.job}>{form.job}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 bg-surface-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="employeeImageUrl" className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-primary" />
                  صورة الموظف (موقع الحجز)
                </Label>
                {form.imageUrl.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patchForm({ imageUrl: '' })}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3.5 h-3.5 ml-1" />
                    مسح الصورة
                  </Button>
                )}
              </div>
              <Input
                id="employeeImageUrl"
                value={form.imageUrl}
                onChange={(e) => patchForm({ imageUrl: e.target.value })}
                placeholder="https://res.cloudinary.com/... أو /barber-ziad.jpg"
                dir="ltr"
                className="font-mono text-xs"
              />

              <div className="flex flex-wrap items-center gap-2">
                <Label
                  htmlFor="employeeImageFile"
                  className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs cursor-pointer hover:bg-surface-muted ${
                    uploadingImage ? 'opacity-60 pointer-events-none' : ''
                  }`}
                >
                  {uploadingImage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-primary" />
                  )}
                  {uploadingImage ? 'جاري الرفع على Cloudinary...' : 'رفع صورة من الجهاز'}
                </Label>
                <input
                  id="employeeImageFile"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploadingImage || saving}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    void handleImageFileUpload(file);
                  }}
                />
                <span className="text-[11px] text-muted-foreground">
                  JPG / PNG / WebP — حتى 5MB
                </span>
              </div>
              {imageUploadError && (
                <p className="text-xs text-destructive">{imageUploadError}</p>
              )}

              <p className="text-xs text-muted-foreground leading-relaxed">
                ارفع صورة من الجهاز (Cloudinary) أو الصق رابط https — أو اختر من صور المشروع أدناه.
                بعد الحفظ تظهر في API الحجز للموقع.
              </p>

              {form.imageUrl.trim() ? (
                <div className="rounded-lg border border-border overflow-hidden bg-surface">
                  <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground">
                    معاينة الصورة
                  </div>
                  <div className="relative h-40 bg-surface-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.imageUrl.trim()}
                      alt="معاينة صورة الموظف"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = '0.25';
                      }}
                    />
                  </div>
                  <div className="px-3 py-2 text-xs text-muted-foreground font-mono truncate" dir="ltr">
                    {form.imageUrl.trim()}
                  </div>
                </div>
              ) : (
                <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted/30 text-muted-foreground">
                  <div className="flex flex-col items-center gap-1 text-xs">
                    <ImageIcon className="w-5 h-5 opacity-50" />
                    <span>لا توجد صورة — الموقع سيعرض Placeholder</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">اختيار سريع من صور المشروع</Label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {BARBER_IMAGE_PRESETS.map((preset) => {
                    const isSelected = form.imageUrl.trim() === preset.path;
                    return (
                      <button
                        key={preset.path}
                        type="button"
                        title={preset.label}
                        onClick={() => patchForm({ imageUrl: preset.path })}
                        className={`group relative overflow-hidden rounded-lg border transition-all ${
                          isSelected
                            ? 'border-primary ring-1 ring-primary/40'
                            : 'border-border hover:border-muted-foreground/50'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preset.path}
                          alt={preset.label}
                          className="h-16 w-full object-cover"
                        />
                        <span className="absolute inset-x-0 bottom-0 bg-background/80 text-[10px] py-0.5 text-center truncate px-1">
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>نوع التوظيف *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(['full_time', 'part_time', 'freelance'] as EmploymentType[]).map((et) => (
                  <RadioCard
                    key={et}
                    selected={form.employmentType === et}
                    onClick={() => handleEmploymentTypeChange(et)}
                    title={EMPLOYMENT_TYPE_LABELS[et]}
                    description={employmentTypeHelper(et)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-border/70 p-3 sm:p-4">
              <EmployeeBranchPayrollFields
                createMode={mode === 'create'}
                scope={compScope}
                onScopeChange={onCompScopeChange}
                details={compDetails}
                branches={compBranches}
                onBranchChange={patchCompBranch}
                effectiveFrom={compDate}
                onEffectiveFromChange={setCompDate}
                globalSalary={compGlobalSalary}
                onGlobalSalaryChange={setCompGlobalSalary}
                vipEligible={vipEligible}
                today={cairoToday}
              />
              {isRetroVip && employee && (
                <RetroPayrollAgreementReview
                  ref={retroReviewRef}
                  onActionStateChange={setRetroAction}
                  empId={employee.EmpID}
                  effectiveFrom={compDate}
                  branches={compBranches}
                  onApplied={(message) => {
                    onSaved(message);
                    onOpenChange(false);
                  }}
                />
              )}
              {isRetroVip && hasOtherUnsavedChanges && (
                <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-500">
                  فيه تعديلات أخرى على بيانات الموظف غير محفوظة. احفظها أو ارجعها قبل اعتماد تسوية مالية،
                  عشان ما يحصلش فقدان صامت لأي تعديل.
                </p>
              )}
              {compScope === 'global' && !isPersistedVip && (
                <div className="space-y-4">
            <div className="space-y-2">
              <Label>طريقة المحاسبة *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {payrollOptions.map((pm) => (
                  <RadioCard
                    key={pm}
                    selected={form.payrollMethod === pm}
                    onClick={() => patchForm({ payrollMethod: pm })}
                    title={PAYROLL_METHOD_LABELS[pm]}
                    description={payrollMethodHelper(pm)}
                  />
                ))}
              </div>
              {form.employmentType === 'freelance' && form.payrollMethod === 'monthly' && (
                <p className="text-xs text-destructive">{FREELANCE_MONTHLY_ERROR}</p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label className="text-sm">تفعيل نظام الرواتب</Label>
                {!form.isPayrollEnabled && (
                  <p className="text-xs text-muted-foreground mt-1">
                    هذا الموظف لن يدخل في كشوف الرواتب أو اليوميات
                  </p>
                )}
              </div>
              <Switch
                checked={form.isPayrollEnabled}
                onCheckedChange={(v) => patchForm({ isPayrollEnabled: v })}
              />
            </div>

            {form.isPayrollEnabled && form.payrollMethod === 'hourly' && (
              <div className="space-y-1.5">
                <Label>سعر الساعة *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.manualHourlyRate}
                  onChange={(e) => patchForm({ manualHourlyRate: e.target.value })}
                  placeholder="25"
                  dir="ltr"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  اتفاقية راتب عامة للموظف — تُطبَّق على كل الفروع ما لم تُضبط خطة فرع صريحة
                </p>
              </div>
            )}

            {form.isPayrollEnabled && form.payrollMethod === 'daily' && (
              <div className="space-y-1.5">
                <Label>قيمة اليومية *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.dailyRate}
                  onChange={(e) => patchForm({ dailyRate: e.target.value })}
                  placeholder="150"
                  dir="ltr"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  اتفاقية راتب عامة للموظف — تُطبَّق على كل الفروع ما لم تُضبط خطة فرع صريحة
                </p>
              </div>
            )}

            {form.isPayrollEnabled && form.payrollMethod === 'monthly' && (
              <div className="space-y-1.5">
                <Label>الراتب الشهري *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthlySalary}
                  onChange={(e) => patchForm({ monthlySalary: e.target.value })}
                  placeholder="5000"
                  dir="ltr"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  اتفاقية راتب عامة للموظف — تُطبَّق على كل الفروع ما لم تُضبط خطة فرع صريحة
                </p>
              </div>
            )}

                </div>
              )}
            </div>
          </section>

          {/* SECTION 2 */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground border-b border-border pb-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              ٢ — مواعيد وأيام العمل
            </h3>

            {form.employmentType === 'freelance' && (
              <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted-foreground leading-relaxed">
                الفري لانس لا يتم إنشاء جدول ثابت له، ولا يظهر كغائب. يتم حسابه فقط في
                الأيام التي يسجل فيها حضور. يمكن تحديد وقت افتراضي اختياري أدناه.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  {form.employmentType === 'freelance'
                    ? 'ساعة بداية (اختياري)'
                    : 'ساعة بداية العمل *'}
                </Label>
                <Input
                  type="time"
                  value={form.defaultStartTime}
                  onChange={(e) => {
                    markScheduleTouched();
                    patchForm({ defaultStartTime: e.target.value });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {form.employmentType === 'freelance'
                    ? 'ساعة نهاية (اختياري)'
                    : 'ساعة نهاية العمل *'}
                </Label>
                <Input
                  type="time"
                  value={form.defaultEndTime}
                  onChange={(e) => {
                    markScheduleTouched();
                    patchForm({ defaultEndTime: e.target.value });
                  }}
                />
              </div>
            </div>

            {form.employmentType === 'full_time' && (
              <div className="space-y-3">
                <Label>سياسة الإجازة الأسبوعية</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['fixed_weekly', 'flexible_weekly'] as DayOffPolicy[]).map((policy) => (
                    <RadioCard
                      key={policy}
                      selected={form.dayOffPolicy === policy}
                      onClick={() => {
                        markScheduleTouched();
                        patchForm({ dayOffPolicy: policy });
                      }}
                      title={DAY_OFF_POLICY_LABELS[policy]}
                    />
                  ))}
                </div>

                {form.dayOffPolicy === 'fixed_weekly' && (
                  <div className="space-y-1.5">
                    <Label>يوم الإجازة الأسبوعي *</Label>
                    <Select
                      value={form.weeklyDayOff}
                      onValueChange={(v) => {
                        markScheduleTouched();
                        patchForm({ weeklyDayOff: v });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر يوم الإجازة" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {form.employmentType === 'part_time' && (
              <div className="space-y-2">
                <Label>أيام العمل *</Label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(WEEKDAY_LABELS).map(([value, label]) => {
                    const day = parseInt(value, 10);
                    const selected = form.workingDays.includes(day);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleWorkingDay(day)}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                          selected
                            ? 'bg-primary/15 border-primary text-primary'
                            : 'border-border text-muted-foreground hover:bg-surface-muted'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {preview && form.employmentType !== 'freelance' && (
              <p className="text-xs text-primary bg-primary/5 border border-primary/20 rounded-lg p-2.5">
                {preview}
              </p>
            )}

            {mode === 'edit' && !scheduleTouched && initialForm && (
              <p className="text-xs text-muted-foreground">
                لن يتم تعديل الجدول الأسبوعي إلا إذا غيّرت مواعيد أو أيام العمل.
              </p>
            )}
          </section>

          {/* SECTION 3 */}
          <section className="space-y-3">
            <button
              type="button"
              className="w-full flex items-center justify-between text-sm font-semibold text-foreground border-b border-border pb-2"
              onClick={() => setOptionalOpen((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" />
                ٣ — بيانات إضافية اختيارية
              </span>
              {optionalOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {optionalOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="space-y-1.5">
                  <Label>رقم الهاتف</Label>
                  <Input
                    value={form.mobile}
                    onChange={(e) => patchForm({ mobile: e.target.value })}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>واتساب</Label>
                  <Input
                    value={form.whatsApp}
                    onChange={(e) => patchForm({ whatsApp: e.target.value })}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>الرقم القومي</Label>
                  <Input
                    value={form.nationalID}
                    onChange={(e) => patchForm({ nationalID: e.target.value })}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>العنوان</Label>
                  <Input value={form.address} onChange={(e) => patchForm({ address: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>اسم جهة الطوارئ</Label>
                  <Input
                    value={form.emergencyContactName}
                    onChange={(e) => patchForm({ emergencyContactName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>هاتف جهة الطوارئ</Label>
                  <Input
                    value={form.emergencyContactPhone}
                    onChange={(e) => patchForm({ emergencyContactPhone: e.target.value })}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>ملاحظات</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => patchForm({ notes: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>
            )}
          </section>

          {(error || compensationError) && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error || compensationError}</span>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-border" dir="ltr">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || Boolean(retroAction?.busy && isRetroVip)}>
              إلغاء
            </Button>
            <Button
              onClick={() => isRetroVip
                ? void retroReviewRef.current?.submit()
                : void handleSubmit()}
              disabled={isRetroVip ? !canSubmitRetro : !canSubmit}
              className="gap-2"
            >
              {saving || (isRetroVip && retroAction?.busy) ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isRetroVip
                    ? retroAction?.applying ? 'جاري اعتماد التسوية...' : 'جاري حساب الأثر...'
                    : 'جاري الحفظ...'}
                </>
              ) : isRetroVip ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {retroAction?.canApprove ? 'اعتماد التسوية المالية' :
                    retroAction?.hasPreview && retroAction.blocked ? 'إعادة معاينة الأثر' : 'معاينة أثر التغيير'}
                </>
              ) : mode === 'create' ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  إضافة الموظف
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  حفظ التعديلات
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
