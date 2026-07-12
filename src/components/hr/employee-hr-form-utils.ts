import type { DayOffPolicy, EmploymentType, PayrollMethod } from '@/lib/hr/employee-hr-model';
import {
  EMPLOYMENT_TYPE_LABELS,
  PAYROLL_METHOD_LABELS,
  DAY_OFF_POLICY_LABELS,
  FREELANCE_MONTHLY_ERROR,
  defaultDayOffPolicyForEmploymentType,
  isFreelanceMonthlyBlocked,
} from '@/lib/hr/employee-hr-model';
import { sqlTimeForInput } from '@/lib/timeUtils';

export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'الأحد',
  1: 'الإثنين',
  2: 'الثلاثاء',
  3: 'الأربعاء',
  4: 'الخميس',
  5: 'الجمعة',
  6: 'السبت',
};

export interface HrEmployeeListRow {
  EmpID: number;
  EmpName: string;
  Job?: string | null;
  isActive: boolean;
  HireDate?: string | null;
  EmploymentType?: string | null;
  PayrollMethod?: string | null;
  DayOffPolicy?: string | null;
  DailyRate?: number | null;
  ManualHourlyRate?: number | null;
  BaseSalary?: number | null;
  DefaultCheckInTime?: string | null;
  DefaultCheckOutTime?: string | null;
  IsPayrollEnabled?: boolean | null;
  employmentTypeLabel?: string | null;
  payrollMethodLabel?: string | null;
  dayOffPolicyLabel?: string | null;
  WhatsApp?: string | null;
  Mobile?: string | null;
}

export interface ProfileScheduleRow {
  DayOfWeek: number;
  IsWorkingDay: boolean | number;
}

export interface EmployeeProfileExtras {
  Job?: string | null;
  Mobile?: string | null;
  WhatsApp?: string | null;
  NationalID?: string | null;
  Address?: string | null;
  EmergencyContactName?: string | null;
  EmergencyContactPhone?: string | null;
  Notes?: string | null;
  PersonalNotes?: string | null;
}

export interface EmployeeHrFormState {
  empName: string;
  isActive: boolean;
  hireDate: string;
  employmentType: EmploymentType;
  payrollMethod: PayrollMethod;
  dayOffPolicy: DayOffPolicy;
  isPayrollEnabled: boolean;
  manualHourlyRate: string;
  dailyRate: string;
  monthlySalary: string;
  defaultStartTime: string;
  defaultEndTime: string;
  weeklyDayOff: string;
  workingDays: number[];
  job: string;
  mobile: string;
  whatsApp: string;
  nationalID: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
}

export function createEmptyEmployeeHrFormState(): EmployeeHrFormState {
  return {
    empName: '',
    isActive: true,
    hireDate: '',
    employmentType: 'full_time',
    payrollMethod: 'hourly',
    dayOffPolicy: 'fixed_weekly',
    isPayrollEnabled: true,
    manualHourlyRate: '',
    dailyRate: '',
    monthlySalary: '',
    defaultStartTime: '',
    defaultEndTime: '',
    weeklyDayOff: '5',
    workingDays: [],
    job: '',
    mobile: '',
    whatsApp: '',
    nationalID: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    notes: '',
  };
}

export function parseScheduleToFormFields(
  schedule: ProfileScheduleRow[],
  employmentType: EmploymentType,
  dayOffPolicy: DayOffPolicy,
): Pick<EmployeeHrFormState, 'weeklyDayOff' | 'workingDays'> {
  if (!schedule.length) {
    return { weeklyDayOff: '5', workingDays: [] };
  }

  const working = schedule
    .filter((r) => Boolean(r.IsWorkingDay))
    .map((r) => r.DayOfWeek);
  const off = schedule
    .filter((r) => !r.IsWorkingDay)
    .map((r) => r.DayOfWeek);

  if (employmentType === 'part_time') {
    return { weeklyDayOff: '5', workingDays: working };
  }

  if (employmentType === 'full_time' && dayOffPolicy === 'fixed_weekly' && off.length === 1) {
    return { weeklyDayOff: String(off[0]), workingDays: working };
  }

  return { weeklyDayOff: '5', workingDays: working };
}

export function employeeToFormState(
  emp: HrEmployeeListRow,
  profile?: EmployeeProfileExtras | null,
  schedule?: ProfileScheduleRow[] | null,
): EmployeeHrFormState {
  const employmentType = (emp.EmploymentType as EmploymentType) || 'full_time';
  const payrollMethod = (emp.PayrollMethod as PayrollMethod) || 'hourly';
  const dayOffPolicy =
    (emp.DayOffPolicy as DayOffPolicy) ||
    defaultDayOffPolicyForEmploymentType(employmentType);

  const scheduleFields = parseScheduleToFormFields(
    schedule ?? [],
    employmentType,
    dayOffPolicy,
  );

  const hireDateRaw = emp.HireDate;
  const hireDate =
    hireDateRaw != null
      ? String(hireDateRaw).slice(0, 10)
      : '';

  return {
    empName: emp.EmpName ?? '',
    isActive: emp.isActive !== false,
    hireDate,
    employmentType,
    payrollMethod,
    dayOffPolicy:
      employmentType === 'full_time' ? dayOffPolicy : 'none',
    isPayrollEnabled: emp.IsPayrollEnabled !== false,
    manualHourlyRate:
      emp.ManualHourlyRate != null && emp.ManualHourlyRate > 0
        ? String(emp.ManualHourlyRate)
        : '',
    dailyRate:
      emp.DailyRate != null && emp.DailyRate > 0 ? String(emp.DailyRate) : '',
    monthlySalary:
      emp.BaseSalary != null && emp.BaseSalary > 0 ? String(emp.BaseSalary) : '',
    defaultStartTime: sqlTimeForInput(emp.DefaultCheckInTime),
    defaultEndTime: sqlTimeForInput(emp.DefaultCheckOutTime),
    weeklyDayOff: scheduleFields.weeklyDayOff,
    workingDays: scheduleFields.workingDays,
    job: profile?.Job ?? emp.Job ?? '',
    mobile: profile?.Mobile ?? emp.Mobile ?? '',
    whatsApp: profile?.WhatsApp ?? emp.WhatsApp ?? '',
    nationalID: profile?.NationalID ?? '',
    address: profile?.Address ?? '',
    emergencyContactName: profile?.EmergencyContactName ?? '',
    emergencyContactPhone: profile?.EmergencyContactPhone ?? '',
    notes: profile?.Notes ?? profile?.PersonalNotes ?? '',
  };
}

export function availablePayrollMethods(
  employmentType: EmploymentType,
): PayrollMethod[] {
  if (employmentType === 'freelance') {
    return ['hourly', 'daily'];
  }
  return ['hourly', 'daily', 'monthly'];
}

export interface FormValidationResult {
  ok: boolean;
  error: string | null;
}

export function validateEmployeeHrForm(form: EmployeeHrFormState): FormValidationResult {
  if (!form.empName.trim()) {
    return { ok: false, error: 'اسم الموظف مطلوب' };
  }

  if (isFreelanceMonthlyBlocked(form.employmentType, form.payrollMethod)) {
    return { ok: false, error: FREELANCE_MONTHLY_ERROR };
  }

  if (form.isPayrollEnabled) {
    if (form.payrollMethod === 'hourly') {
      const rate = parseFloat(form.manualHourlyRate);
      if (!form.manualHourlyRate || Number.isNaN(rate) || rate <= 0) {
        return { ok: false, error: 'سعر الساعة مطلوب ويجب أن يكون أكبر من صفر' };
      }
    } else if (form.payrollMethod === 'daily') {
      const rate = parseFloat(form.dailyRate);
      if (!form.dailyRate || Number.isNaN(rate) || rate <= 0) {
        return { ok: false, error: 'قيمة اليومية مطلوبة ويجب أن تكون أكبر من صفر' };
      }
    } else if (form.payrollMethod === 'monthly') {
      const rate = parseFloat(form.monthlySalary);
      if (!form.monthlySalary || Number.isNaN(rate) || rate <= 0) {
        return { ok: false, error: 'الراتب الشهري مطلوب ويجب أن يكون أكبر من صفر' };
      }
    }
  }

  if (form.employmentType !== 'freelance') {
    if (!form.defaultStartTime || !form.defaultEndTime) {
      return { ok: false, error: 'يجب تحديد وقت بداية ونهاية العمل' };
    }
  }

  if (form.employmentType === 'full_time' && form.dayOffPolicy === 'fixed_weekly') {
    if (form.weeklyDayOff === '' || form.weeklyDayOff == null) {
      return { ok: false, error: 'يجب اختيار يوم إجازة واحد للدوام الكامل بإجازة ثابتة' };
    }
  }

  if (form.employmentType === 'part_time') {
    if (!form.workingDays.length) {
      return { ok: false, error: 'اختر يوم عمل واحد على الأقل للدوام الجزئي' };
    }
  }

  return { ok: true, error: null };
}

export function buildEmployeeHrApiPayload(
  form: EmployeeHrFormState,
  options: { mode: 'create' | 'edit'; includeSchedule: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    empName: form.empName.trim(),
    isActive: form.isActive,
    employmentType: form.employmentType,
    payrollMethod: form.payrollMethod,
    dayOffPolicy:
      form.employmentType === 'full_time' ? form.dayOffPolicy : 'none',
    isPayrollEnabled: form.isPayrollEnabled,
  };

  if (form.hireDate) payload.hireDate = form.hireDate;

  if (form.payrollMethod === 'hourly' && form.manualHourlyRate) {
    payload.manualHourlyRate = parseFloat(form.manualHourlyRate);
  }
  if (form.payrollMethod === 'daily' && form.dailyRate) {
    payload.dailyRate = parseFloat(form.dailyRate);
  }
  if (form.payrollMethod === 'monthly' && form.monthlySalary) {
    payload.monthlySalary = parseFloat(form.monthlySalary);
  }

  if (form.defaultStartTime) payload.defaultStartTime = form.defaultStartTime;
  if (form.defaultEndTime) payload.defaultEndTime = form.defaultEndTime;

  const shouldIncludeSchedule =
    options.includeSchedule &&
    form.employmentType !== 'freelance' &&
    form.defaultStartTime &&
    form.defaultEndTime;

  if (shouldIncludeSchedule) {
    if (form.employmentType === 'full_time') {
      if (form.dayOffPolicy === 'fixed_weekly') {
        payload.scheduleConfig = { weeklyDayOff: parseInt(form.weeklyDayOff, 10) };
      } else {
        payload.scheduleConfig = {};
      }
    } else if (form.employmentType === 'part_time') {
      payload.scheduleConfig = { workingDays: [...form.workingDays].sort((a, b) => a - b) };
    }
  }

  return payload;
}

export function buildProfileApiPayload(
  form: EmployeeHrFormState,
): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {
    EmpName: form.empName.trim(),
  };

  let hasOptional = false;
  const set = (key: string, value: string) => {
    payload[key] = value.trim() || null;
    hasOptional = true;
  };

  if (form.job.trim()) set('Job', form.job);
  if (form.mobile.trim()) set('Mobile', form.mobile);
  if (form.whatsApp.trim()) set('WhatsApp', form.whatsApp);
  if (form.nationalID.trim()) set('NationalID', form.nationalID);
  if (form.address.trim()) set('Address', form.address);
  if (form.emergencyContactName.trim()) set('EmergencyContactName', form.emergencyContactName);
  if (form.emergencyContactPhone.trim()) set('EmergencyContactPhone', form.emergencyContactPhone);
  if (form.notes.trim()) set('Notes', form.notes);

  return hasOptional || form.empName.trim() ? payload : null;
}

export function employmentTypeHelper(employmentType: EmploymentType): string {
  switch (employmentType) {
    case 'full_time':
      return 'موظف ثابت له نظام حضور وجدول عمل';
    case 'part_time':
      return 'موظف يعمل أيام محددة في الأسبوع';
    case 'freelance':
      return 'بدون جدول ثابت، لا يظهر كغائب، ويُحاسب فقط عند تسجيل حضوره';
  }
}

export function payrollMethodHelper(method: PayrollMethod): string {
  switch (method) {
    case 'hourly':
      return 'يتم الحساب من عدد ساعات الحضور × سعر الساعة';
    case 'daily':
      return 'يستحق قيمة ثابتة عند الحضور';
    case 'monthly':
      return 'يتم تسويته شهريًا ولا يدخل في اليوميات اليومية';
  }
}

export function schedulePreviewText(form: EmployeeHrFormState): string | null {
  if (form.employmentType === 'full_time') {
    if (form.dayOffPolicy === 'fixed_weekly') {
      const day = WEEKDAY_LABELS[parseInt(form.weeklyDayOff, 10)];
      return `سيتم إنشاء جدول من ٦ أيام عمل ويوم إجازة${day ? ` (${day})` : ''}`;
    }
    if (form.dayOffPolicy === 'flexible_weekly') {
      return 'سيتم إنشاء جدول ٧ أيام عمل، ويمكن ترحيل الإجازة أو تسجيلها يدويًا لاحقًا';
    }
  }
  if (form.employmentType === 'part_time' && form.workingDays.length) {
    const labels = form.workingDays
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS[d])
      .join('، ');
    return `أيام العمل: ${labels}`;
  }
  return null;
}

export function labelEmploymentType(value: string | null | undefined): string {
  if (value && value in EMPLOYMENT_TYPE_LABELS) {
    return EMPLOYMENT_TYPE_LABELS[value as EmploymentType];
  }
  return '—';
}

export function labelPayrollMethod(value: string | null | undefined): string {
  if (value && value in PAYROLL_METHOD_LABELS) {
    return PAYROLL_METHOD_LABELS[value as PayrollMethod];
  }
  return '—';
}

export function labelDayOffPolicy(value: string | null | undefined): string {
  if (value && value in DAY_OFF_POLICY_LABELS) {
    return DAY_OFF_POLICY_LABELS[value as DayOffPolicy];
  }
  return '—';
}
