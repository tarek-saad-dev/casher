import { describe, expect, it } from 'vitest';
import {
  buildExemptCheckInLateMessage,
  buildFinalDeductionMessage,
  buildLateAlertMessage,
} from '../messages';

describe('late deduction WhatsApp message builders', () => {
  it('minute-1 alert includes quarter-day warning and amount', () => {
    const msg = buildLateAlertMessage({
      threshold: 1,
      scheduledStart: '12:00',
      lateMinutes: 1,
      quarterAmount: 75,
      halfAmount: 150,
      exempt: false,
    });
    expect(msg).toContain('Late Attendance Alert');
    expect(msg).toContain('quarter-day deduction bracket');
    expect(msg).toContain('75.00 EGP');
  });

  it('minute-61 alert mentions half-day increase', () => {
    const msg = buildLateAlertMessage({
      threshold: 61,
      scheduledStart: '12:00',
      lateMinutes: 61,
      quarterAmount: 75,
      halfAmount: 150,
      exempt: false,
    });
    expect(msg).toContain('half-day deduction');
    expect(msg).toContain('150.00 EGP');
  });

  it('minute-121 alert escalates to management without claiming an amount', () => {
    const msg = buildLateAlertMessage({
      threshold: 121,
      scheduledStart: '12:00',
      lateMinutes: 121,
      quarterAmount: 75,
      halfAmount: 150,
      exempt: false,
    });
    expect(msg).toContain('referred to management');
    expect(msg).not.toContain('Potential deduction');
  });

  it('exempt employees do not receive financial penalty warnings', () => {
    const msg = buildLateAlertMessage({
      threshold: 1,
      scheduledStart: '12:00',
      lateMinutes: 1,
      quarterAmount: 75,
      halfAmount: 150,
      exempt: true,
    });
    expect(msg).toContain('Attendance Reminder');
    expect(msg).not.toContain('deduction');
    expect(msg).not.toContain('EGP');
  });

  it('final confirmation includes amount and type', () => {
    const msg = buildFinalDeductionMessage({
      checkInTime: '12:20',
      lateMinutes: 20,
      amount: 75,
      bracket: 'quarter',
    });
    expect(msg).toContain('Attendance Recorded');
    expect(msg).toContain('75.00 EGP');
    expect(msg).toContain('Quarter-day');
  });

  it('exempt check-in message does not claim a deduction', () => {
    const msg = buildExemptCheckInLateMessage({
      checkInTime: '12:20',
      lateMinutes: 20,
    });
    expect(msg).toContain('No automatic late deduction was applied');
  });

  it('manager-review employee ack does not ask the employee to enter a penalty', async () => {
    const { buildManagerReviewEmployeeAckMessage } = await import('../messages');
    const msg = buildManagerReviewEmployeeAckMessage({
      checkInTime: '14:10',
      lateMinutes: 130,
    });
    expect(msg).toContain('referred to management');
    expect(msg).not.toContain('Please enter the final penalty');
  });
});
