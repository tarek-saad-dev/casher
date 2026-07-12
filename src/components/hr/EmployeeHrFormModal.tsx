'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  UserPlus,
  Users,
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
import type { DayOffPolicy, EmploymentType, PayrollMethod } from '@/lib/hr/employee-hr-model';
import {
  EMPLOYMENT_TYPE_LABELS,
  PAYROLL_METHOD_LABELS,
  DAY_OFF_POLICY_LABELS,
  FREELANCE_MONTHLY_ERROR,
} from '@/lib/hr/employee-hr-model';
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

  const patchForm = useCallback((partial: Partial<EmployeeHrFormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
  }, []);

  const markScheduleTouched = useCallback(() => {
    setScheduleTouched(true);
  }, []);

  const loadEditData = useCallback(async (emp: HrEmployeeListRow) => {
    setLoadingProfile(true);
    setError('');
    try {
      let profile = null;
      let schedule = null;
      const res = await fetch(`/api/admin/employees/${emp.EmpID}/profile`);
      if (res.ok) {
        const data = await res.json();
        profile = data.employee ?? null;
        schedule = data.schedule ?? null;
      }
      const next = employeeToFormState(emp, profile, schedule);
      setForm(next);
      setInitialForm(next);
      setScheduleTouched(false);
    } catch {
      const next = employeeToFormState(emp);
      setForm(next);
      setInitialForm(next);
      setScheduleTouched(false);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError('');
    setOptionalOpen(false);
    if (mode === 'create') {
      const empty = createEmptyEmployeeHrFormState();
      setForm(empty);
      setInitialForm(empty);
      setScheduleTouched(true);
    } else if (employee) {
      void loadEditData(employee);
    }
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

  const preview = schedulePreviewText(form);
  const validation = validateEmployeeHrForm(form);
  const canSubmit = validation.ok && !saving && !loadingProfile;

  const handleEmploymentTypeChange = (employmentType: EmploymentType) => {
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
    const v = validateEmployeeHrForm(form);
    if (!v.ok) {
      setError(v.error ?? 'تحقق من البيانات');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const includeSchedule =
        mode === 'create'
          ? form.employmentType !== 'freelance'
          : scheduleTouched && form.employmentType !== 'freelance';

      const hrPayload = buildEmployeeHrApiPayload(form, { mode, includeSchedule });

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

      onSaved(`تم تحديث ملف "${form.empName.trim()}" بنجاح`);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <div className="space-y-1.5 sm:col-span-2">
                <Label>اسم الموظف *</Label>
                <Input
                  value={form.empName}
                  onChange={(e) => patchForm({ empName: e.target.value })}
                  placeholder="مثال: محمد أحمد"
                />
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
              </div>
            )}
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
                  <Label>المسمى الوظيفي</Label>
                  <Input value={form.job} onChange={(e) => patchForm({ job: e.target.value })} />
                </div>
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

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-border" dir="ltr">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit} className="gap-2">
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الحفظ...
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
