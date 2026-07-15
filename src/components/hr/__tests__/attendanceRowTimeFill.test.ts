import { describe, expect, it } from 'vitest';
import {
  applyDefaultTimesToRow,
  applyNowTimesToRow,
} from '@/components/hr/attendance-row-time-fill';

const baseRow = {
  CheckInTime: null,
  CheckOutTime: null,
  DefaultCheckInTime: '09:00',
  DefaultCheckOutTime: '17:00',
  ScheduledStartTime: '09:00',
  ScheduledEndTime: '17:00',
  Status: 'Pending',
  LateMinutes: 0,
  EarlyLeaveMinutes: 0,
};

describe('attendance-row-time-fill', () => {
  it('D fills default check-in and check-out times', () => {
    const result = applyDefaultTimesToRow(baseRow);
    expect(result.CheckInTime).toBe('09:00');
    expect(result.CheckOutTime).toBe('17:00');
    expect(result.Status).toBe('Present');
    expect(result.LateMinutes).toBe(0);
  });

  it('D only fills missing fields', () => {
    const result = applyDefaultTimesToRow({
      ...baseRow,
      CheckInTime: '10:00',
      Status: 'Late',
      LateMinutes: 60,
    });
    expect(result.CheckInTime).toBe('10:00');
    expect(result.CheckOutTime).toBe('17:00');
    expect(result.Status).toBe('Late');
  });

  it('D marks EarlyLeave when default out is before schedule end', () => {
    const result = applyDefaultTimesToRow({
      ...baseRow,
      CheckInTime: '09:00',
      Status: 'Present',
      DefaultCheckOutTime: '16:00',
      ScheduledEndTime: '17:00',
    });
    expect(result.CheckOutTime).toBe('16:00');
    expect(result.Status).toBe('EarlyLeave');
    expect(result.EarlyLeaveMinutes).toBe(60);
  });

  it('N fills current time for missing check-in/out', () => {
    const result = applyNowTimesToRow(baseRow, '11:30');
    expect(result.CheckInTime).toBe('11:30');
    expect(result.CheckOutTime).toBe('11:30');
    // Late on check-in, then EarlyLeave when check-out (now) is before schedule end
    expect(result.LateMinutes).toBe(150);
    expect(result.EarlyLeaveMinutes).toBe(330);
    expect(result.Status).toBe('EarlyLeave');
  });

  it('N does not overwrite existing times', () => {
    const result = applyNowTimesToRow(
      { ...baseRow, CheckInTime: '09:00', CheckOutTime: '17:00', Status: 'Present' },
      '12:00',
    );
    expect(result.CheckInTime).toBe('09:00');
    expect(result.CheckOutTime).toBe('17:00');
  });
});
