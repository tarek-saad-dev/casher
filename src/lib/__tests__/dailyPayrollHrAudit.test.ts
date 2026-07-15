import { describe, expect, it } from 'vitest';
import {
  buildAuditRow,
  buildDailyPayrollAuditReport,
  classifyEligibilityStatus,
  computeActualHoursFromTimes,
  READ_ONLY_GUARD,
} from '@/lib/payroll/dailyPayrollHrAudit';
import type { AuditEmployeeDbRow } from '@/lib/payroll/dailyPayrollHrAudit';

function emp(overrides: Partial<AuditEmployeeDbRow> = {}): AuditEmployeeDbRow {
  return {
    EmpID: 1,
    EmpName: 'Test',
    isActive: 1,
    IsPayrollEnabled: 1,
    IsAttendanceExempt: 0,
    EmploymentType: 'full_time',
    PayrollMethod: 'hourly',
    DayOffPolicy: 'fixed_weekly',
    ManualHourlyRate: null,
    HourlyRate: null,
    DailyRate: null,
    BaseSalary: null,
    Salary: null,
    ScheduleDayOfWeek: 0,
    IsWorkingDay: 1,
    ScheduleStartTime: '09:00',
    ScheduleEndTime: '17:00',
    DefaultCheckInTime: '09:00',
    DefaultCheckOutTime: '17:00',
    ...overrides,
  };
}

describe('READ_ONLY_GUARD', () => {
  it('disallows writes, generate, and ledger', () => {
    expect(READ_ONLY_GUARD.allowWrites).toBe(false);
    expect(READ_ONLY_GUARD.allowGenerate).toBe(false);
    expect(READ_ONLY_GUARD.allowLedger).toBe(false);
  });
});

describe('computeActualHoursFromTimes', () => {
  it('computes same-day hours', () => {
    expect(computeActualHoursFromTimes('09:00', '17:00')).toBe(8);
  });

  it('computes overnight hours', () => {
    expect(computeActualHoursFromTimes('22:00', '06:00')).toBe(8);
  });

  it('subtracts break minutes for net hours', () => {
    expect(computeActualHoursFromTimes('09:00', '17:00', 60)).toBe(7);
  });
});

describe('buildDailyPayrollAuditReport', () => {
  const workDate = '2026-07-12';
  const attendance = [
    { EmpID: 1, Status: 'Present', CheckInTime: '09:00', CheckOutTime: '17:00' },
  ];

  it('detects monthly excluded', () => {
    const { rows, summary } = buildDailyPayrollAuditReport(
      [emp({ EmpID: 1, EmpName: 'مريم', PayrollMethod: 'monthly' })],
      [],
      workDate,
    );
    expect(rows[0]?.eligibilityStatus).toBe('excluded');
    expect(rows[0]?.reason).toBe('monthly_excluded');
    expect(summary.monthlyExcludedCount).toBe(1);
  });

  it('detects freelance no attendance excluded', () => {
    const { rows, summary } = buildDailyPayrollAuditReport(
      [emp({ EmpID: 2, EmpName: 'أحمد', EmploymentType: 'freelance', ManualHourlyRate: 40 })],
      [],
      workDate,
    );
    expect(rows[0]?.eligibilityStatus).toBe('excluded');
    expect(rows[0]?.reason).toBe('freelance_no_attendance');
    expect(summary.freelanceExcludedCount).toBe(1);
    expect(rows[0]?.highlights).toContain('freelance_no_attendance:ok');
  });

  it('calculates hourly expected wage using ManualHourlyRate', () => {
    const { rows } = buildDailyPayrollAuditReport(
      [emp({ EmpID: 1, ManualHourlyRate: 50 })],
      attendance,
      workDate,
    );
    expect(rows[0]?.eligibilityStatus).toBe('eligible');
    expect(rows[0]?.effectiveHourlyRate).toBe(50);
    expect(rows[0]?.expectedDailyWage).toBe(400);
  });

  it('calculates daily expected wage using DailyRate', () => {
    const { rows } = buildDailyPayrollAuditReport(
      [emp({ EmpID: 1, PayrollMethod: 'daily', DailyRate: 300, ManualHourlyRate: null })],
      attendance,
      workDate,
    );
    expect(rows[0]?.eligibilityStatus).toBe('eligible');
    expect(rows[0]?.expectedDailyWage).toBe(300);
  });

  it('detects no hourly rate error', () => {
    const row = buildAuditRow(emp({ ManualHourlyRate: null, HourlyRate: null }), attendance[0]!);
    expect(row.eligibilityStatus).toBe('error');
    expect(row.reason).toBe('no_hourly_rate');
  });

  it('detects no daily rate error', () => {
    const row = buildAuditRow(
      emp({ PayrollMethod: 'daily', DailyRate: null }),
      attendance[0]!,
    );
    expect(row.eligibilityStatus).toBe('error');
    expect(row.reason).toBe('no_daily_rate');
    expect(row.highlights).toContain('daily_missing:DailyRate');
  });

  it('detects part-time off day excluded', () => {
    const { rows } = buildDailyPayrollAuditReport(
      [
        emp({
          EmpID: 3,
          EmploymentType: 'part_time',
          IsWorkingDay: 0,
          ScheduleStartTime: null,
          ScheduleEndTime: null,
        }),
      ],
      [],
      workDate,
    );
    expect(rows[0]?.eligibilityStatus).toBe('excluded');
    expect(rows[0]?.reason).toBe('part_time_day_off');
    expect(rows[0]?.highlights).toContain('part_time_off_day:ok');
  });

  it('highlights ManualHourlyRate when HourlyRate is NULL', () => {
    const row = buildAuditRow(
      emp({ ManualHourlyRate: 45, HourlyRate: null }),
      attendance[0]!,
    );
    expect(row.highlights).toContain('manual_rate:HourlyRate_NULL');
    expect(row.expectedDailyWage).toBe(360);
  });

  it('highlights hourly fallback when ManualHourlyRate missing', () => {
    const row = buildAuditRow(
      emp({ ManualHourlyRate: null, HourlyRate: 30 }),
      attendance[0]!,
    );
    expect(row.highlights).toContain('hourly_fallback:HourlyRate');
  });

  it('summary totals eligible wages', () => {
    const { summary } = buildDailyPayrollAuditReport(
      [
        emp({ EmpID: 1, ManualHourlyRate: 50 }),
        emp({ EmpID: 2, EmpName: 'Daily', PayrollMethod: 'daily', DailyRate: 200 }),
        emp({ EmpID: 3, EmpName: 'Monthly', PayrollMethod: 'monthly' }),
      ],
      [
        { EmpID: 1, Status: 'Present', CheckInTime: '09:00', CheckOutTime: '17:00' },
        { EmpID: 2, Status: 'Present', CheckInTime: '09:00', CheckOutTime: '17:00' },
      ],
      workDate,
    );
    expect(summary.eligibleCount).toBe(2);
    expect(summary.excludedCount).toBe(1);
    expect(summary.expectedTotalDailyWage).toBe(600);
    expect(summary.expectedHourlyTotal).toBe(400);
    expect(summary.expectedDailyRateTotal).toBe(200);
  });
});

describe('classifyEligibilityStatus', () => {
  it('classifies null reason as eligible', () => {
    expect(classifyEligibilityStatus(null)).toBe('eligible');
  });

  it('classifies validation errors', () => {
    expect(classifyEligibilityStatus('missing_checkout')).toBe('error');
  });

  it('classifies exclusions', () => {
    expect(classifyEligibilityStatus('monthly_excluded')).toBe('excluded');
  });
});
