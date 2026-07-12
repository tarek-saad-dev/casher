import { describe, expect, it } from 'vitest';
import {
  buildPayrollNotesSql,
  calculateDailyWage,
  getEffectiveHourlyRate,
  getPayrollValidationReason,
  isMonthlyExcluded,
  resolvePayrollMethod,
  shouldIncludeInPayrollValidation,
} from '@/lib/payroll/dailyPayrollHrRules';
import type {
  PayrollAttendanceRow,
  PayrollEmployeeRow,
  PayrollScheduleDay,
} from '@/lib/payroll/dailyPayrollHrRules';

function emp(overrides: Partial<PayrollEmployeeRow> = {}): PayrollEmployeeRow {
  return {
    EmpID: 1,
    EmpName: 'Test',
    isActive: 1,
    IsPayrollEnabled: 1,
    EmploymentType: 'full_time',
    PayrollMethod: 'hourly',
    ManualHourlyRate: null,
    HourlyRate: null,
    DailyRate: null,
    Salary: null,
    BaseSalary: null,
    ...overrides,
  };
}

const workingSchedule: PayrollScheduleDay = {
  hasScheduleRow: true,
  isWorkingDay: true,
  scheduleStart: '09:00',
  scheduleEnd: '17:00',
};

const offSchedule: PayrollScheduleDay = {
  hasScheduleRow: true,
  isWorkingDay: false,
  scheduleStart: null,
  scheduleEnd: null,
};

const presentAtt: PayrollAttendanceRow = {
  Status: 'Present',
  CheckInTime: '09:00',
  CheckOutTime: '17:00',
};

describe('resolvePayrollMethod legacy fallback', () => {
  it('maps missing PayrollMethod + SalaryType monthly to monthly', () => {
    expect(resolvePayrollMethod(emp({ PayrollMethod: null, SalaryType: 'monthly' }))).toBe('monthly');
  });

  it('maps missing PayrollMethod + SalaryType Daily to hourly', () => {
    expect(resolvePayrollMethod(emp({ PayrollMethod: null, SalaryType: 'Daily' }))).toBe('hourly');
  });
});

describe('getEffectiveHourlyRate', () => {
  it('prefers ManualHourlyRate over HourlyRate', () => {
    expect(
      getEffectiveHourlyRate(emp({ ManualHourlyRate: 50, HourlyRate: 30 }), 8),
    ).toBe(50);
  });

  it('uses HourlyRate when ManualHourlyRate missing', () => {
    expect(getEffectiveHourlyRate(emp({ HourlyRate: 30 }), 8)).toBe(30);
  });

  it('supports overnight case where HourlyRate trigger may be NULL', () => {
    expect(
      getEffectiveHourlyRate(emp({ ManualHourlyRate: 45, HourlyRate: null }), 8),
    ).toBe(45);
  });

  it('falls back to Salary / scheduled hours', () => {
    expect(getEffectiveHourlyRate(emp({ Salary: 800, HourlyRate: null }), 8)).toBe(100);
  });
});

describe('calculateDailyWage', () => {
  it('hourly: ActualHours × ManualHourlyRate', () => {
    const wage = calculateDailyWage('hourly', emp({ ManualHourlyRate: 50 }), 8, 8);
    expect(wage).toBe(400);
  });

  it('daily: flat DailyRate regardless of hours', () => {
    const wage = calculateDailyWage('daily', emp({ DailyRate: 300 }), 6.5, 8);
    expect(wage).toBe(300);
  });
});

describe('isMonthlyExcluded', () => {
  it('excludes monthly employees', () => {
    expect(isMonthlyExcluded(emp({ PayrollMethod: 'monthly' }))).toBe(true);
  });
});

describe('getPayrollValidationReason', () => {
  it('full_time hourly working day with complete attendance returns null', () => {
    expect(
      getPayrollValidationReason(
        emp({ ManualHourlyRate: 50 }),
        workingSchedule,
        presentAtt,
        '09:00',
        '17:00',
      ),
    ).toBeNull();
  });

  it('full_time hourly without rate returns no_hourly_rate', () => {
    expect(
      getPayrollValidationReason(emp(), workingSchedule, presentAtt, '09:00', '17:00'),
    ).toBe('no_hourly_rate');
  });

  it('daily employee without DailyRate returns no_daily_rate', () => {
    expect(
      getPayrollValidationReason(
        emp({ PayrollMethod: 'daily' }),
        workingSchedule,
        presentAtt,
        '09:00',
        '17:00',
      ),
    ).toBe('no_daily_rate');
  });

  it('monthly employee returns monthly_excluded', () => {
    expect(
      getPayrollValidationReason(
        emp({ PayrollMethod: 'monthly' }),
        workingSchedule,
        presentAtt,
      ),
    ).toBe('monthly_excluded');
  });

  it('part_time off day without attendance returns part_time_day_off', () => {
    expect(
      getPayrollValidationReason(
        emp({ EmploymentType: 'part_time' }),
        offSchedule,
        null,
      ),
    ).toBe('part_time_day_off');
  });

  it('part_time off day with payable attendance validates rate/times', () => {
    expect(
      getPayrollValidationReason(
        emp({ EmploymentType: 'part_time', ManualHourlyRate: 40 }),
        offSchedule,
        presentAtt,
      ),
    ).toBeNull();
  });

  it('freelance without attendance returns freelance_no_attendance', () => {
    expect(
      getPayrollValidationReason(
        emp({ EmploymentType: 'freelance', ManualHourlyRate: 40 }),
        offSchedule,
        null,
      ),
    ).toBe('freelance_no_attendance');
  });

  it('freelance hourly with attendance validates successfully', () => {
    expect(
      getPayrollValidationReason(
        emp({ EmploymentType: 'freelance', ManualHourlyRate: 40 }),
        offSchedule,
        presentAtt,
      ),
    ).toBeNull();
  });

  it('freelance daily with attendance requires DailyRate', () => {
    expect(
      getPayrollValidationReason(
        emp({ EmploymentType: 'freelance', PayrollMethod: 'daily' }),
        offSchedule,
        presentAtt,
      ),
    ).toBe('no_daily_rate');
  });

  it('payroll disabled returns payroll_disabled', () => {
    expect(
      getPayrollValidationReason(
        emp({ IsPayrollEnabled: 0 }),
        workingSchedule,
        presentAtt,
      ),
    ).toBe('payroll_disabled');
  });

  it('inactive returns inactive_employee', () => {
    expect(
      getPayrollValidationReason(
        emp({ isActive: 0 }),
        workingSchedule,
        presentAtt,
      ),
    ).toBe('inactive_employee');
  });
});

describe('shouldIncludeInPayrollValidation', () => {
  it('freelance without attendance is not included', () => {
    expect(
      shouldIncludeInPayrollValidation(
        emp({ EmploymentType: 'freelance' }),
        offSchedule,
        null,
      ),
    ).toBe(false);
  });

  it('part_time working day is included', () => {
    expect(
      shouldIncludeInPayrollValidation(
        emp({ EmploymentType: 'part_time', ManualHourlyRate: 30 }),
        workingSchedule,
        null,
        '09:00',
        '17:00',
      ),
    ).toBe(true);
  });
});

describe('buildPayrollNotesSql', () => {
  it('casts numerics via DECIMAL then NVARCHAR to avoid float overflow', () => {
    const sql = buildPayrollNotesSql('', 'hours_expr');
    expect(sql).toContain('CONVERT(NVARCHAR(32), CAST(ISNULL((e.DailyRate), 0) AS DECIMAL(18,2)))');
    expect(sql).toContain('CONVERT(NVARCHAR(32), CAST(ISNULL((hours_expr), 0) AS DECIMAL(18,2)))');
    expect(sql).not.toMatch(/AS NVARCHAR\(10\)/);
  });
});
