import { describe, expect, it } from 'vitest';
import { classifyDay, canAssignDayAttendance } from '@/lib/hr/employeePayrollGapReview.classify';

describe('payroll gap day classification', () => {
  const through = '2026-08-27';

  it('marks future days', () => {
    const r = classifyDay({
      workDate: '2026-08-28',
      reviewThroughDate: through,
      isScheduledOff: false,
      hasAttendance: false,
      attendanceStatus: null,
      checkIn: null,
      checkOut: null,
      hasPayroll: false,
      payrollStatus: null,
    });
    expect(r.category).toBe('future');
    expect(r.actionable).toBe(false);
  });

  it('marks scheduled off day without attendance', () => {
    const r = classifyDay({
      workDate: '2026-08-09',
      reviewThroughDate: through,
      isScheduledOff: true,
      hasAttendance: false,
      attendanceStatus: null,
      checkIn: null,
      checkOut: null,
      hasPayroll: false,
      payrollStatus: null,
    });
    expect(r.category).toBe('schedule_off');
    expect(r.actionable).toBe(true);
    expect(r.categoryLabelAr).toContain('الأحد');
  });

  it('flags scheduled off with payroll as actionable', () => {
    const r = classifyDay({
      workDate: '2026-08-02',
      reviewThroughDate: through,
      isScheduledOff: true,
      hasAttendance: true,
      attendanceStatus: 'Present',
      checkIn: '15:00',
      checkOut: '02:00',
      hasPayroll: true,
      payrollStatus: 'Generated',
    });
    // worked on scheduled off day — payroll exists, not forced off
    expect(r.category).toBe('ok');
  });

  it('flags payroll on empty scheduled off day', () => {
    const r = classifyDay({
      workDate: '2026-08-02',
      reviewThroughDate: through,
      isScheduledOff: true,
      hasAttendance: false,
      attendanceStatus: null,
      checkIn: null,
      checkOut: null,
      hasPayroll: true,
      payrollStatus: 'Generated',
    });
    expect(r.category).toBe('schedule_off_with_payroll');
    expect(r.actionable).toBe(true);
  });

  it('flags incomplete attendance', () => {
    const r = classifyDay({
      workDate: '2026-08-26',
      reviewThroughDate: through,
      isScheduledOff: false,
      hasAttendance: true,
      attendanceStatus: 'Present',
      checkIn: '16:00',
      checkOut: null,
      hasPayroll: false,
      payrollStatus: null,
    });
    expect(r.category).toBe('incomplete_attendance');
    expect(r.actionable).toBe(true);
  });

  it('flags attendance without payroll', () => {
    const r = classifyDay({
      workDate: '2026-08-06',
      reviewThroughDate: through,
      isScheduledOff: false,
      hasAttendance: true,
      attendanceStatus: 'Present',
      checkIn: '15:30',
      checkOut: '02:00',
      hasPayroll: false,
      payrollStatus: null,
    });
    expect(r.category).toBe('attendance_no_payroll');
    expect(r.actionable).toBe(true);
  });

  it('marks no attendance as assignable', () => {
    const r = classifyDay({
      workDate: '2026-08-10',
      reviewThroughDate: through,
      isScheduledOff: false,
      hasAttendance: false,
      attendanceStatus: null,
      checkIn: null,
      checkOut: null,
      hasPayroll: false,
      payrollStatus: null,
    });
    expect(r.category).toBe('no_attendance');
    expect(r.actionable).toBe(true);
    expect(
      canAssignDayAttendance(
        {
          workDate: '2026-08-10',
          category: r.category,
          hasAttendance: false,
        },
        through,
      ),
    ).toBe(true);
  });
});
