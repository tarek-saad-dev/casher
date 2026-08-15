import { describe, expect, it } from 'vitest';
import {
  preferAttendanceRowForDate,
  preferPayrollRowForDate,
} from '@/lib/reports/employeeMonthlyCrossBranchPrefer';

describe('preferAttendanceRowForDate', () => {
  it('keeps session row when it has check-in', () => {
    const session = { BranchID: 1, CheckInTime: '09:00', CheckOutTime: '17:00' };
    const other = { BranchID: 2, CheckInTime: '10:00', CheckOutTime: '18:00' };
    expect(preferAttendanceRowForDate([other, session], 1)).toBe(session);
  });

  it('falls back to other branch when session has no check-in', () => {
    const session = { BranchID: 1, CheckInTime: null, CheckOutTime: null };
    const other = { BranchID: 2, CheckInTime: '10:00', CheckOutTime: '18:00' };
    expect(preferAttendanceRowForDate([session, other], 1)).toBe(other);
  });

  it('works with a single row from any branch', () => {
    const only = { BranchID: 2, CheckInTime: '11:00', CheckOutTime: null };
    expect(preferAttendanceRowForDate([only], 1)).toBe(only);
  });
});

describe('preferPayrollRowForDate', () => {
  it('falls back to wage on another branch', () => {
    const session = { BranchID: 1, DailyWage: null, ActualHours: null };
    const other = { BranchID: 2, DailyWage: 400, ActualHours: 8 };
    expect(preferPayrollRowForDate([session, other], 1)).toBe(other);
  });
});
