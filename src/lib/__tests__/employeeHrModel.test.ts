import { describe, expect, it } from 'vitest';
import {
  EMPLOYMENT_TYPE_LABELS,
  PAYROLL_METHOD_LABELS,
  DAY_OFF_POLICY_LABELS,
  FREELANCE_MONTHLY_ERROR,
  enrichEmployeeRow,
  isFreelanceMonthlyBlocked,
  isValidDayOffPolicy,
  isValidEmploymentType,
  isValidPayrollMethod,
  mapNormalizedToDbColumns,
  normalizeDayOffPolicy,
  normalizeEmploymentType,
  normalizePayrollMethod,
  payrollMethodToLegacySalaryType,
  resolveDayOffPolicy,
  usesHrModelPayload,
  validateEmployeeHrPayload,
} from '@/lib/hr/employee-hr-model';

describe('employeeHrModel validators', () => {
  it('validates employment types and payroll methods', () => {
    expect(isValidEmploymentType('full_time')).toBe(true);
    expect(isValidEmploymentType('part_time')).toBe(true);
    expect(isValidEmploymentType('freelance')).toBe(true);
    expect(isValidEmploymentType('contract')).toBe(false);

    expect(isValidPayrollMethod('hourly')).toBe(true);
    expect(isValidPayrollMethod('daily')).toBe(true);
    expect(isValidPayrollMethod('monthly')).toBe(true);
    expect(isValidPayrollMethod('weekly')).toBe(false);
  });

  it('normalizes enum values case-insensitively', () => {
    expect(normalizeEmploymentType('FULL_TIME')).toBe('full_time');
    expect(normalizePayrollMethod('Monthly')).toBe('monthly');
  });

  it('blocks freelance + monthly', () => {
    expect(isFreelanceMonthlyBlocked('freelance', 'monthly')).toBe(true);
    expect(isFreelanceMonthlyBlocked('freelance', 'hourly')).toBe(false);
    expect(isFreelanceMonthlyBlocked('full_time', 'monthly')).toBe(false);
  });

  it('exposes Arabic labels', () => {
    expect(EMPLOYMENT_TYPE_LABELS.full_time).toBe('دوام كامل');
    expect(PAYROLL_METHOD_LABELS.hourly).toBe('بالساعة');
    expect(DAY_OFF_POLICY_LABELS.flexible_weekly).toBe('إجازة أسبوعية مرنة');
  });

  it('validates day off policies', () => {
    expect(isValidDayOffPolicy('fixed_weekly')).toBe(true);
    expect(isValidDayOffPolicy('flexible_weekly')).toBe(true);
    expect(isValidDayOffPolicy('none')).toBe(true);
    expect(normalizeDayOffPolicy('FLEXIBLE_WEEKLY')).toBe('flexible_weekly');
  });

  it('resolves day off policy by employment type', () => {
    expect(
      resolveDayOffPolicy({ dayOffPolicy: 'flexible_weekly' }, 'full_time', 'fixed_weekly'),
    ).toBe('flexible_weekly');
    expect(resolveDayOffPolicy({}, 'part_time', 'fixed_weekly')).toBe('none');
    expect(resolveDayOffPolicy({}, 'full_time', null)).toBe('fixed_weekly');
  });

  it('maps payroll method to legacy SalaryType', () => {
    expect(payrollMethodToLegacySalaryType('monthly')).toBe('monthly');
    expect(payrollMethodToLegacySalaryType('hourly')).toBe('Daily');
    expect(payrollMethodToLegacySalaryType('daily')).toBe('Daily');
  });
});

describe('validateEmployeeHrPayload', () => {
  it('allows legacy minimal create payload', () => {
    const result = validateEmployeeHrPayload({ empName: 'أحمد' }, {
      mode: 'create',
      isHrPayload: false,
    });
    expect(result.ok).toBe(true);
    expect(result.normalized).toBeUndefined();
  });

  it('rejects create without empName', () => {
    const result = validateEmployeeHrPayload({}, { mode: 'create', isHrPayload: false });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('اسم الموظف');
  });

  it('requires hourly rate for full_time hourly create', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'أحمد',
        employmentType: 'full_time',
        payrollMethod: 'hourly',
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('سعر الساعة');
  });

  it('accepts full_time hourly create with rate', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'أحمد',
        employmentType: 'full_time',
        payrollMethod: 'hourly',
        manualHourlyRate: 25,
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(true);
    expect(result.normalized?.employmentType).toBe('full_time');
    expect(result.normalized?.payrollMethod).toBe('hourly');
    expect(result.normalized?.manualHourlyRate).toBe(25);
    expect(result.normalized?.legacySalaryType).toBe('Daily');
  });

  it('accepts full_time daily create with DailyRate and SalaryType Daily', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'أحمد',
        employmentType: 'full_time',
        payrollMethod: 'daily',
        dailyRate: 150,
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(true);
    const db = mapNormalizedToDbColumns(result.normalized!);
    expect(db.PayrollMethod).toBe('daily');
    expect(db.DailyRate).toBe(150);
    expect(db.SalaryType).toBe('Daily');
    expect(db.Salary).toBe(150);
  });

  it('accepts monthly create with SalaryType monthly', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'أحمد',
        employmentType: 'full_time',
        payrollMethod: 'monthly',
        monthlySalary: 5000,
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(true);
    const db = mapNormalizedToDbColumns(result.normalized!);
    expect(db.PayrollMethod).toBe('monthly');
    expect(db.SalaryType).toBe('monthly');
    expect(db.BaseSalary).toBe(5000);
  });

  it('sets freelance hourly IsAttendanceExempt and rejects freelance monthly', () => {
    const ok = validateEmployeeHrPayload(
      {
        empName: 'طارق',
        employmentType: 'freelance',
        payrollMethod: 'hourly',
        manualHourlyRate: 30,
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(ok.ok).toBe(true);
    expect(ok.normalized?.isAttendanceExempt).toBe(true);

    const blocked = validateEmployeeHrPayload(
      {
        empName: 'طارق',
        employmentType: 'freelance',
        payrollMethod: 'monthly',
        monthlySalary: 5000,
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.errors[0]).toBe(FREELANCE_MONTHLY_ERROR);
  });

  it('allows freelance daily', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'طارق',
        employmentType: 'freelance',
        payrollMethod: 'daily',
        dailyRate: 200,
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(true);
  });

  it('requires schedule times for full_time with scheduleConfig', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'أحمد',
        employmentType: 'full_time',
        payrollMethod: 'hourly',
        manualHourlyRate: 25,
        scheduleConfig: { weeklyDayOff: 5 },
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('وقت بداية'))).toBe(true);
  });

  it('full_time flexible_weekly does not require weeklyDayOff', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'محمد',
        employmentType: 'full_time',
        payrollMethod: 'hourly',
        dayOffPolicy: 'flexible_weekly',
        manualHourlyRate: 25,
        defaultStartTime: '09:00',
        defaultEndTime: '17:00',
        scheduleConfig: {},
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(true);
    expect(result.normalized?.dayOffPolicy).toBe('flexible_weekly');
  });

  it('full_time fixed_weekly requires weeklyDayOff when scheduleConfig provided', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'أحمد',
        employmentType: 'full_time',
        payrollMethod: 'hourly',
        dayOffPolicy: 'fixed_weekly',
        manualHourlyRate: 25,
        defaultStartTime: '09:00',
        defaultEndTime: '17:00',
        scheduleConfig: {},
      },
      { mode: 'create', isHrPayload: true },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('إجازة ثابتة'))).toBe(true);
  });

  it('patch employmentType to freelance without re-sending rates', () => {
    const result = validateEmployeeHrPayload(
      { employmentType: 'freelance' },
      {
        mode: 'patch',
        isHrPayload: true,
        currentEmploymentType: 'full_time',
        currentPayrollMethod: 'hourly',
        currentIsPayrollEnabled: true,
        currentManualHourlyRate: 25,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.normalized?.isAttendanceExempt).toBe(true);
  });

  it('patch payrollMethod to monthly while freelance is blocked', () => {
    const result = validateEmployeeHrPayload(
      { payrollMethod: 'monthly' },
      {
        mode: 'patch',
        isHrPayload: true,
        currentEmploymentType: 'freelance',
        currentPayrollMethod: 'hourly',
        currentIsPayrollEnabled: true,
        currentBaseSalary: 5000,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toBe(FREELANCE_MONTHLY_ERROR);
  });

  it('patch hireDate only does not require rates', () => {
    const result = validateEmployeeHrPayload(
      { hireDate: '2026-01-01' },
      {
        mode: 'patch',
        isHrPayload: true,
        currentEmploymentType: 'full_time',
        currentPayrollMethod: 'hourly',
        currentIsPayrollEnabled: true,
        currentManualHourlyRate: 25,
      },
    );
    expect(result.ok).toBe(true);
  });
});

describe('usesHrModelPayload and enrichEmployeeRow', () => {
  it('detects HR payload fields', () => {
    expect(usesHrModelPayload({ empName: 'x' })).toBe(false);
    expect(usesHrModelPayload({ empName: 'x', payrollMethod: 'hourly' })).toBe(true);
  });

  it('adds Arabic labels to employee rows', () => {
    const row = enrichEmployeeRow({
      EmpID: 1,
      EmploymentType: 'full_time',
      PayrollMethod: 'hourly',
      DayOffPolicy: 'flexible_weekly',
    });
    expect(row.employmentTypeLabel).toBe('دوام كامل');
    expect(row.payrollMethodLabel).toBe('بالساعة');
    expect(row.dayOffPolicyLabel).toBe('إجازة أسبوعية مرنة');
  });

  it('stores DayOffPolicy in DB column mapping', () => {
    const result = validateEmployeeHrPayload(
      {
        empName: 'محمد',
        employmentType: 'full_time',
        payrollMethod: 'hourly',
        dayOffPolicy: 'flexible_weekly',
        manualHourlyRate: 25,
      },
      { mode: 'create', isHrPayload: true },
    );
    const db = mapNormalizedToDbColumns(result.normalized!);
    expect(db.DayOffPolicy).toBe('flexible_weekly');
  });
});
