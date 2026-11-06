import { describe, expect, it } from 'vitest';
import {
  isLateDeductionEligibleAttendanceStatus,
  isLateDeductionExcludedAttendanceStatus,
  normalizeAttendanceStatus,
} from '../attendanceStatus';

describe('late deduction attendance status classification', () => {
  it('normalizes casing and whitespace', () => {
    expect(normalizeAttendanceStatus('  Absent ')).toBe('absent');
    expect(normalizeAttendanceStatus('Day Off')).toBe('dayoff');
    expect(normalizeAttendanceStatus('DAY_OFF')).toBe('dayoff');
  });

  it('treats employee AttendanceTab lowercase statuses as excluded', () => {
    expect(isLateDeductionExcludedAttendanceStatus('absent')).toBe(true);
    expect(isLateDeductionExcludedAttendanceStatus('off')).toBe(true);
    expect(isLateDeductionExcludedAttendanceStatus('Absent')).toBe(true);
    expect(isLateDeductionExcludedAttendanceStatus('DayOff')).toBe(true);
    expect(isLateDeductionExcludedAttendanceStatus('Excused')).toBe(true);
  });

  it('keeps present/late eligible for lateness calculation', () => {
    expect(isLateDeductionEligibleAttendanceStatus('present')).toBe(true);
    expect(isLateDeductionEligibleAttendanceStatus('late')).toBe(true);
    expect(isLateDeductionEligibleAttendanceStatus('Present')).toBe(true);
    expect(isLateDeductionEligibleAttendanceStatus('absent')).toBe(false);
    expect(isLateDeductionEligibleAttendanceStatus('off')).toBe(false);
  });
});
