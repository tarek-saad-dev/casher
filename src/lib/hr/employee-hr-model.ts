/**
 * Employee HR model — EmploymentType + PayrollMethod (Phase 2).
 * Validation and field mapping only; payroll/attendance behavior unchanged until later phases.
 */

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'freelance'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PAYROLL_METHODS = ['hourly', 'daily', 'monthly'] as const;
export type PayrollMethod = (typeof PAYROLL_METHODS)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'دوام كامل',
  part_time: 'دوام جزئي',
  freelance: 'فري لانس',
};

export const PAYROLL_METHOD_LABELS: Record<PayrollMethod, string> = {
  hourly: 'بالساعة',
  daily: 'يومية',
  monthly: 'شهري',
};

export const DAY_OFF_POLICIES = ['fixed_weekly', 'flexible_weekly', 'none'] as const;
export type DayOffPolicy = (typeof DAY_OFF_POLICIES)[number];

export const DAY_OFF_POLICY_LABELS: Record<DayOffPolicy, string> = {
  fixed_weekly: 'إجازة أسبوعية ثابتة',
  flexible_weekly: 'إجازة أسبوعية مرنة',
  none: 'بدون إجازة أسبوعية ثابتة',
};

export const FREELANCE_MONTHLY_ERROR =
  'الفري لانس يتم حسابه بالساعة أو اليومية فقط';

export interface ScheduleDayConfig {
  dayOfWeek: number;
  isWorkingDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
  notes?: string | null;
}

export interface ScheduleConfigInput {
  /** Full-time weekly day off (0=Sunday … 6=Saturday). */
  weeklyDayOff?: number;
  /** Part-time selected working days. */
  workingDays?: number[];
  /** Explicit 7-day schedule override. */
  days?: ScheduleDayConfig[];
}

export interface EmployeeHrPayload {
  empName?: string;
  isActive?: boolean;
  employmentType?: string;
  payrollMethod?: string;
  dayOffPolicy?: string;
  isPayrollEnabled?: boolean;
  isAttendanceExempt?: boolean;
  defaultStartTime?: string | null;
  defaultEndTime?: string | null;
  defaultCheckInTime?: string | null;
  defaultCheckOutTime?: string | null;
  hireDate?: string | null;
  manualHourlyRate?: number | string | null;
  hourlyRate?: number | string | null;
  dailyRate?: number | string | null;
  monthlySalary?: number | string | null;
  baseSalary?: number | string | null;
  salary?: number | string | null;
  weeklyDayOff?: number;
  workingDays?: number[];
  scheduleConfig?: ScheduleConfigInput;
  optionalDetails?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ValidateEmployeeHrOptions {
  mode: 'create' | 'patch';
  /** True when payload uses the new HR model (not legacy minimal create). */
  isHrPayload: boolean;
  currentEmploymentType?: EmploymentType | null;
  currentPayrollMethod?: PayrollMethod | null;
  currentDayOffPolicy?: DayOffPolicy | null;
  currentIsPayrollEnabled?: boolean;
  currentManualHourlyRate?: number | null;
  currentDailyRate?: number | null;
  currentBaseSalary?: number | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  normalized?: NormalizedHrFields;
}

export interface NormalizedHrFields {
  empName?: string;
  isActive?: boolean;
  employmentType: EmploymentType;
  payrollMethod: PayrollMethod;
  dayOffPolicy: DayOffPolicy;
  isPayrollEnabled: boolean;
  isAttendanceExempt: boolean;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  hireDate: string | null;
  manualHourlyRate: number | null;
  dailyRate: number | null;
  monthlySalary: number | null;
  baseSalary: number | null;
  salary: number | null;
  weeklyDayOff: number | null;
  workingDays: number[] | null;
  scheduleConfig: ScheduleConfigInput | null;
  legacySalaryType: string;
}

const TIME_RE = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidEmploymentType(
  value: string | null | undefined,
): value is EmploymentType {
  return EMPLOYMENT_TYPES.includes(value as EmploymentType);
}

export function isValidPayrollMethod(
  value: string | null | undefined,
): value is PayrollMethod {
  return PAYROLL_METHODS.includes(value as PayrollMethod);
}

export function isValidDayOffPolicy(
  value: string | null | undefined,
): value is DayOffPolicy {
  return DAY_OFF_POLICIES.includes(value as DayOffPolicy);
}

export function isFreelanceMonthlyBlocked(
  employmentType: EmploymentType | string | null | undefined,
  payrollMethod: PayrollMethod | string | null | undefined,
): boolean {
  return employmentType === 'freelance' && payrollMethod === 'monthly';
}

export function normalizeEmploymentType(
  value: string | null | undefined,
): EmploymentType | null {
  if (value == null || String(value).trim() === '') return null;
  const v = String(value).trim().toLowerCase();
  if (isValidEmploymentType(v)) return v;
  return null;
}

export function normalizePayrollMethod(
  value: string | null | undefined,
): PayrollMethod | null {
  if (value == null || String(value).trim() === '') return null;
  const v = String(value).trim().toLowerCase();
  if (isValidPayrollMethod(v)) return v;
  return null;
}

export function normalizeDayOffPolicy(
  value: string | null | undefined,
): DayOffPolicy | null {
  if (value == null || String(value).trim() === '') return null;
  const v = String(value).trim().toLowerCase();
  if (isValidDayOffPolicy(v)) return v;
  return null;
}

export function defaultDayOffPolicyForEmploymentType(
  employmentType: EmploymentType,
): DayOffPolicy {
  return employmentType === 'full_time' ? 'fixed_weekly' : 'none';
}

/** Resolves effective day-off policy from payload, current row, and employment type. */
export function resolveDayOffPolicy(
  payload: EmployeeHrPayload,
  employmentType: EmploymentType,
  currentDayOffPolicy?: DayOffPolicy | null,
): DayOffPolicy {
  if (employmentType !== 'full_time') {
    return 'none';
  }
  const explicit = normalizeDayOffPolicy(payload.dayOffPolicy);
  if (explicit) return explicit;
  if (currentDayOffPolicy) return currentDayOffPolicy;
  return defaultDayOffPolicyForEmploymentType(employmentType);
}

export function employmentTypeLabel(
  value: EmploymentType | string | null | undefined,
): string | null {
  if (!value || !isValidEmploymentType(value)) return null;
  return EMPLOYMENT_TYPE_LABELS[value];
}

export function payrollMethodLabel(
  value: PayrollMethod | string | null | undefined,
): string | null {
  if (!value || !isValidPayrollMethod(value)) return null;
  return PAYROLL_METHOD_LABELS[value];
}

export function dayOffPolicyLabel(
  value: DayOffPolicy | string | null | undefined,
): string | null {
  if (!value || !isValidDayOffPolicy(value)) return null;
  return DAY_OFF_POLICY_LABELS[value];
}

/** Legacy SalaryType kept in sync until Phase 4. */
export function payrollMethodToLegacySalaryType(method: PayrollMethod): string {
  return method === 'monthly' ? 'monthly' : 'Daily';
}

/** True when any HR-model field is present (beyond legacy empName/isActive). */
export function usesHrModelPayload(payload: EmployeeHrPayload): boolean {
  const hrKeys = [
    'employmentType',
    'payrollMethod',
    'dayOffPolicy',
    'scheduleConfig',
    'defaultStartTime',
    'defaultEndTime',
    'defaultCheckInTime',
    'defaultCheckOutTime',
    'hireDate',
    'manualHourlyRate',
    'hourlyRate',
    'dailyRate',
    'monthlySalary',
    'weeklyDayOff',
    'workingDays',
    'baseSalary',
    'salary',
    'isPayrollEnabled',
    'isAttendanceExempt',
  ] as const;
  return hrKeys.some((k) => payload[k] !== undefined);
}

function parseOptionalNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n;
}

function normalizeTime(value: string | null | undefined): string | null {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const match = raw.match(TIME_RE);
  if (!match) return null;
  const h = match[1].padStart(2, '0');
  const m = match[2];
  const s = match[3] ?? '00';
  return `${h}:${m}:${s}`;
}

function resolveDefaultTimes(payload: EmployeeHrPayload): {
  start: string | null;
  end: string | null;
} {
  const start =
    normalizeTime(payload.defaultStartTime ?? payload.defaultCheckInTime ?? null);
  const end =
    normalizeTime(payload.defaultEndTime ?? payload.defaultCheckOutTime ?? null);
  return { start, end };
}

function resolveScheduleConfig(payload: EmployeeHrPayload): ScheduleConfigInput | null {
  if (payload.scheduleConfig) {
    return {
      weeklyDayOff: payload.scheduleConfig.weeklyDayOff ?? payload.weeklyDayOff,
      workingDays: payload.scheduleConfig.workingDays ?? payload.workingDays,
      days: payload.scheduleConfig.days,
    };
  }
  if (payload.weeklyDayOff !== undefined || payload.workingDays !== undefined) {
    return {
      weeklyDayOff: payload.weeklyDayOff,
      workingDays: payload.workingDays,
    };
  }
  return null;
}

function isValidDayOfWeek(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 6;
}

export function validateEmployeeHrPayload(
  payload: EmployeeHrPayload,
  options: ValidateEmployeeHrOptions,
): ValidationResult {
  const errors: string[] = [];

  if (options.mode === 'create') {
    const name = payload.empName != null ? String(payload.empName).trim() : '';
    if (!name) {
      errors.push('اسم الموظف مطلوب');
    }
  }

  if (!options.isHrPayload) {
    return { ok: errors.length === 0, errors };
  }

  const employmentType =
    normalizeEmploymentType(payload.employmentType) ??
    options.currentEmploymentType ??
    'full_time';

  const payrollMethod =
    normalizePayrollMethod(payload.payrollMethod) ??
    options.currentPayrollMethod ??
    'hourly';

  if (payload.employmentType !== undefined && !normalizeEmploymentType(payload.employmentType)) {
    errors.push('نوع التوظيف غير صالح');
  }
  if (payload.payrollMethod !== undefined && !normalizePayrollMethod(payload.payrollMethod)) {
    errors.push('طريقة الدفع غير صالحة');
  }
  if (payload.dayOffPolicy !== undefined && !normalizeDayOffPolicy(payload.dayOffPolicy)) {
    errors.push('سياسة الإجازة غير صالحة');
  }

  const dayOffPolicy = resolveDayOffPolicy(
    payload,
    employmentType,
    options.currentDayOffPolicy ?? null,
  );

  if (isFreelanceMonthlyBlocked(employmentType, payrollMethod)) {
    errors.push(FREELANCE_MONTHLY_ERROR);
  }

  const isPayrollEnabled =
    options.mode === 'patch'
      ? payload.isPayrollEnabled ?? options.currentIsPayrollEnabled ?? true
      : payload.isPayrollEnabled !== false;
  const { start, end } = resolveDefaultTimes(payload);
  const scheduleConfig = resolveScheduleConfig(payload);

  if (start && !end) errors.push('يجب تحديد وقت البدء والانتهاء معاً');
  if (!start && end) errors.push('يجب تحديد وقت البدء والانتهاء معاً');
  if (start && !TIME_RE.test(start.length === 8 ? start.slice(0, 5) : start)) {
    /* already normalized or invalid handled above */
  }

  if (payload.hireDate != null && payload.hireDate !== '' && !DATE_RE.test(String(payload.hireDate))) {
    errors.push('تاريخ التعيين يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const manualHourlyRate =
    parseOptionalNumber(payload.manualHourlyRate ?? payload.hourlyRate ?? null);
  const dailyRate = parseOptionalNumber(payload.dailyRate);
  const monthlySalary = parseOptionalNumber(
    payload.monthlySalary ?? payload.baseSalary ?? null,
  );
  const baseSalary = parseOptionalNumber(payload.baseSalary);
  const salary = parseOptionalNumber(payload.salary);

  const payrollMethodTouched =
    options.mode === 'create' || payload.payrollMethod !== undefined;
  const payrollEnableTouched = payload.isPayrollEnabled === true;

  if (isPayrollEnabled) {
    if (payrollMethod === 'hourly') {
      const rateTouched =
        payload.manualHourlyRate !== undefined || payload.hourlyRate !== undefined;
      const effectiveRate =
        manualHourlyRate ?? options.currentManualHourlyRate ?? null;
      if (
        payrollMethodTouched ||
        payrollEnableTouched ||
        rateTouched ||
        options.mode === 'create'
      ) {
        if (effectiveRate == null || effectiveRate <= 0) {
          errors.push('سعر الساعة مطلوب عند تفعيل نظام الرواتب');
        }
      }
    } else if (payrollMethod === 'daily') {
      const rateTouched = payload.dailyRate !== undefined;
      const effectiveRate = dailyRate ?? options.currentDailyRate ?? null;
      if (
        payrollMethodTouched ||
        payrollEnableTouched ||
        rateTouched ||
        options.mode === 'create'
      ) {
        if (effectiveRate == null || effectiveRate <= 0) {
          errors.push('اليومية مطلوبة عند تفعيل نظام الرواتب');
        }
      }
    } else if (payrollMethod === 'monthly') {
      const rateTouched =
        payload.monthlySalary !== undefined || payload.baseSalary !== undefined;
      const ms =
        parseOptionalNumber(payload.monthlySalary) ??
        baseSalary ??
        options.currentBaseSalary ??
        null;
      if (
        payrollMethodTouched ||
        payrollEnableTouched ||
        rateTouched ||
        options.mode === 'create'
      ) {
        if (ms == null || ms <= 0) {
          errors.push('الراتب الشهري مطلوب عند تفعيل نظام الرواتب');
        }
      }
    }
  }

  if (scheduleConfig) {
    if (employmentType === 'full_time') {
      if (dayOffPolicy === 'fixed_weekly') {
        const dayOff =
          scheduleConfig.weeklyDayOff ??
          (scheduleConfig.days
            ? scheduleConfig.days
                .filter((d) => d.isWorkingDay === false)
                .map((d) => d.dayOfWeek)
            : null);
        if (dayOff == null || (Array.isArray(dayOff) && dayOff.length !== 1)) {
          if (typeof scheduleConfig.weeklyDayOff !== 'number') {
            const offDays =
              scheduleConfig.days?.filter((d) => d.isWorkingDay === false) ?? [];
            if (offDays.length !== 1) {
              errors.push('الدوام الكامل بإجازة ثابتة يتطلب يوم إجازة أسبوعي واحد');
            }
          }
        } else if (typeof scheduleConfig.weeklyDayOff === 'number') {
          if (!isValidDayOfWeek(scheduleConfig.weeklyDayOff)) {
            errors.push('يوم الإجازة الأسبوعي غير صالح');
          }
        }
        if (scheduleConfig.days?.length === 7) {
          const workingCount = scheduleConfig.days.filter(
            (d) => d.isWorkingDay !== false,
          ).length;
          if (workingCount !== 6) {
            errors.push('الدوام الكامل بإجازة ثابتة يتطلب 6 أيام عمل');
          }
        }
      }
      if (!start || !end) {
        errors.push('وقت بداية ونهاية العمل مطلوبان للدوام الكامل');
      }
    } else if (employmentType === 'part_time') {
      const days =
        scheduleConfig.workingDays ??
        scheduleConfig.days?.filter((d) => d.isWorkingDay !== false).map((d) => d.dayOfWeek);
      if (!days || days.length < 1) {
        errors.push('الدوام الجزئي يتطلب يوم عمل واحد على الأقل');
      }
      if (!start || !end) {
        errors.push('وقت بداية ونهاية العمل مطلوبان للدوام الجزئي');
      }
    }
    // freelance: no fixed schedule required
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const explicitExempt = payload.isAttendanceExempt;
  const isAttendanceExempt =
    explicitExempt !== undefined
      ? Boolean(explicitExempt)
      : employmentType === 'freelance';

  return {
    ok: true,
    errors: [],
    normalized: {
      empName:
        payload.empName !== undefined ? String(payload.empName).trim() : undefined,
      isActive: payload.isActive,
      employmentType,
      payrollMethod,
      dayOffPolicy,
      isPayrollEnabled,
      isAttendanceExempt,
      defaultStartTime: start,
      defaultEndTime: end,
      hireDate:
        payload.hireDate != null && String(payload.hireDate).trim() !== ''
          ? String(payload.hireDate)
          : null,
      manualHourlyRate:
        manualHourlyRate ??
        (options.mode === 'patch' ? options.currentManualHourlyRate ?? null : null),
      dailyRate:
        dailyRate ?? (options.mode === 'patch' ? options.currentDailyRate ?? null : null),
      monthlySalary:
        monthlySalary ??
        (options.mode === 'patch' ? options.currentBaseSalary ?? null : null),
      baseSalary,
      salary,
      weeklyDayOff:
        scheduleConfig?.weeklyDayOff != null ? scheduleConfig.weeklyDayOff : null,
      workingDays: scheduleConfig?.workingDays ?? null,
      scheduleConfig,
      legacySalaryType: payrollMethodToLegacySalaryType(payrollMethod),
    },
  };
}

export interface HrDbColumnValues {
  EmploymentType: EmploymentType;
  PayrollMethod: PayrollMethod;
  DayOffPolicy: DayOffPolicy;
  IsPayrollEnabled: number;
  IsAttendanceExempt: number;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  HireDate: string | null;
  ManualHourlyRate: number | null;
  DailyRate: number | null;
  BaseSalary: number | null;
  Salary: number | null;
  SalaryType: string;
}

/** Maps normalized HR fields to TblEmp column values for INSERT/UPDATE. */
export function mapNormalizedToDbColumns(
  fields: NormalizedHrFields,
): HrDbColumnValues {
  let baseSalary = fields.baseSalary;
  let salary = fields.salary;

  if (fields.payrollMethod === 'monthly') {
    baseSalary = fields.monthlySalary ?? baseSalary;
  } else if (fields.payrollMethod === 'daily') {
    if (fields.dailyRate != null) {
      salary = fields.dailyRate;
      if (baseSalary == null) baseSalary = fields.dailyRate;
    }
  }

  return {
    EmploymentType: fields.employmentType,
    PayrollMethod: fields.payrollMethod,
    DayOffPolicy: fields.dayOffPolicy,
    IsPayrollEnabled: fields.isPayrollEnabled ? 1 : 0,
    IsAttendanceExempt: fields.isAttendanceExempt ? 1 : 0,
    DefaultCheckInTime: fields.defaultStartTime,
    DefaultCheckOutTime: fields.defaultEndTime,
    HireDate: fields.hireDate,
    ManualHourlyRate: fields.manualHourlyRate,
    DailyRate: fields.dailyRate,
    BaseSalary: baseSalary,
    Salary: salary,
    SalaryType: fields.legacySalaryType,
  };
}

export function enrichEmployeeRow<T extends Record<string, unknown>>(
  row: T,
): T & {
  employmentTypeLabel: string | null;
  payrollMethodLabel: string | null;
  dayOffPolicyLabel: string | null;
} {
  const et = row.EmploymentType ?? row.employmentType;
  const pm = row.PayrollMethod ?? row.payrollMethod;
  const dop = row.DayOffPolicy ?? row.dayOffPolicy;
  return {
    ...row,
    employmentTypeLabel: employmentTypeLabel(
      typeof et === 'string' ? et : null,
    ),
    payrollMethodLabel: payrollMethodLabel(
      typeof pm === 'string' ? pm : null,
    ),
    dayOffPolicyLabel: dayOffPolicyLabel(typeof dop === 'string' ? dop : null),
  };
}
