import { describe, expect, it } from 'vitest';
import {
  availablePayrollMethods,
  buildEmployeeHrApiPayload,
  createEmptyEmployeeHrFormState,
  employeeToFormState,
  parseScheduleToFormFields,
  validateEmployeeHrForm,
  type HrEmployeeListRow,
} from '@/components/hr/employee-hr-form-utils';

describe('employee-hr-form-utils', () => {
  it('freelance hides monthly payroll method options', () => {
    expect(availablePayrollMethods('freelance')).toEqual(['hourly', 'daily']);
    expect(availablePayrollMethods('full_time')).toContain('monthly');
  });

  it('validates hourly rate when payroll enabled', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'أحمد',
      defaultStartTime: '09:00',
      defaultEndTime: '17:00',
      payrollMethod: 'hourly' as const,
      manualHourlyRate: '',
    };
    expect(validateEmployeeHrForm(form).ok).toBe(false);
    form.manualHourlyRate = '25';
    expect(validateEmployeeHrForm(form).ok).toBe(true);
  });

  it('validates daily and monthly rates', () => {
    const daily = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'سارة',
      employmentType: 'part_time' as const,
      payrollMethod: 'daily' as const,
      workingDays: [0, 2],
      defaultStartTime: '10:00',
      defaultEndTime: '18:00',
      dailyRate: '150',
    };
    expect(validateEmployeeHrForm(daily).ok).toBe(true);

    const monthly = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'محمد',
      payrollMethod: 'monthly' as const,
      defaultStartTime: '09:00',
      defaultEndTime: '17:00',
      weeklyDayOff: '5',
      monthlySalary: '5000',
    };
    expect(validateEmployeeHrForm(monthly).ok).toBe(true);
  });

  it('blocks freelance monthly', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'طارق',
      employmentType: 'freelance' as const,
      payrollMethod: 'monthly' as const,
      manualHourlyRate: '30',
    };
    expect(validateEmployeeHrForm(form).ok).toBe(false);
  });

  it('full_time fixed_weekly requires weeklyDayOff', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'أحمد',
      dayOffPolicy: 'fixed_weekly' as const,
      defaultStartTime: '09:00',
      defaultEndTime: '17:00',
      manualHourlyRate: '25',
      weeklyDayOff: '',
    };
    expect(validateEmployeeHrForm(form).ok).toBe(false);
    form.weeklyDayOff = '5';
    expect(validateEmployeeHrForm(form).ok).toBe(true);
  });

  it('full_time flexible_weekly does not require weeklyDayOff', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'محمد',
      dayOffPolicy: 'flexible_weekly' as const,
      defaultStartTime: '09:00',
      defaultEndTime: '17:00',
      manualHourlyRate: '25',
      weeklyDayOff: '',
    };
    expect(validateEmployeeHrForm(form).ok).toBe(true);
  });

  it('part_time requires at least one working day', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'علي',
      employmentType: 'part_time' as const,
      payrollMethod: 'daily' as const,
      dailyRate: '100',
      defaultStartTime: '09:00',
      defaultEndTime: '17:00',
      workingDays: [] as number[],
    };
    expect(validateEmployeeHrForm(form).ok).toBe(false);
    form.workingDays = [1, 3];
    expect(validateEmployeeHrForm(form).ok).toBe(true);
  });

  it('builds create payload for full_time flexible hourly', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'محمد',
      employmentType: 'full_time' as const,
      payrollMethod: 'hourly' as const,
      dayOffPolicy: 'flexible_weekly' as const,
      manualHourlyRate: '25',
      defaultStartTime: '09:00',
      defaultEndTime: '17:00',
      hireDate: '2026-01-01',
    };
    const payload = buildEmployeeHrApiPayload(form, { mode: 'create', includeSchedule: true });
    expect(payload.employmentType).toBe('full_time');
    expect(payload.dayOffPolicy).toBe('flexible_weekly');
    expect(payload.scheduleConfig).toEqual({});
    expect(payload.manualHourlyRate).toBe(25);
  });

  it('builds create payload for freelance without scheduleConfig', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'طارق',
      employmentType: 'freelance' as const,
      payrollMethod: 'hourly' as const,
      manualHourlyRate: '30',
    };
    const payload = buildEmployeeHrApiPayload(form, { mode: 'create', includeSchedule: true });
    expect(payload.scheduleConfig).toBeUndefined();
    expect(payload.dayOffPolicy).toBe('none');
  });

  it('edit payload omits schedule when includeSchedule false', () => {
    const form = {
      ...createEmptyEmployeeHrFormState(),
      empName: 'أحمد',
      defaultStartTime: '09:00',
      defaultEndTime: '17:00',
      manualHourlyRate: '25',
    };
    const payload = buildEmployeeHrApiPayload(form, { mode: 'edit', includeSchedule: false });
    expect(payload.scheduleConfig).toBeUndefined();
  });

  it('prefills employee from list row', () => {
    const emp: HrEmployeeListRow = {
      EmpID: 7,
      EmpName: 'محمد',
      isActive: true,
      EmploymentType: 'full_time',
      PayrollMethod: 'hourly',
      DayOffPolicy: 'flexible_weekly',
      ManualHourlyRate: 25,
      DefaultCheckInTime: '09:00:00',
      DefaultCheckOutTime: '17:00:00',
      HireDate: '2024-01-15',
      IsPayrollEnabled: true,
    };
    const form = employeeToFormState(emp);
    expect(form.empName).toBe('محمد');
    expect(form.dayOffPolicy).toBe('flexible_weekly');
    expect(form.manualHourlyRate).toBe('25');
    expect(form.defaultStartTime).toBe('09:00');
  });

  it('parses schedule for part_time working days', () => {
    const schedule = [
      { DayOfWeek: 0, IsWorkingDay: true },
      { DayOfWeek: 1, IsWorkingDay: false },
      { DayOfWeek: 2, IsWorkingDay: true },
      { DayOfWeek: 3, IsWorkingDay: false },
      { DayOfWeek: 4, IsWorkingDay: false },
      { DayOfWeek: 5, IsWorkingDay: false },
      { DayOfWeek: 6, IsWorkingDay: false },
    ];
    const parsed = parseScheduleToFormFields(schedule, 'part_time', 'none');
    expect(parsed.workingDays).toEqual([0, 2]);
  });
});
