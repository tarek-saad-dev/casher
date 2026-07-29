import { describe, expect, it } from 'vitest';
import {
  applyDefaultTimesToRow,
  applyNowTimesToRow,
} from '@/lib/hr/attendance-default-fill';

describe('attendance-default-fill', () => {
  it('does not invent times for DayOff / Absent / Excused', () => {
    for (const status of ['DayOff', 'Absent', 'Excused'] as const) {
      const row = {
        CheckInTime: null as string | null,
        CheckOutTime: null as string | null,
        DefaultCheckInTime: '13:00',
        DefaultCheckOutTime: '00:00',
        ScheduledStartTime: '13:00',
        ScheduledEndTime: '00:00',
        Status: status,
        LateMinutes: 0,
        EarlyLeaveMinutes: 0,
      };
      expect(applyDefaultTimesToRow(row).CheckInTime).toBeNull();
      expect(applyDefaultTimesToRow(row).CheckOutTime).toBeNull();
      expect(applyDefaultTimesToRow(row).Status).toBe(status);
      expect(applyNowTimesToRow(row, '15:00').CheckInTime).toBeNull();
      expect(applyNowTimesToRow(row, '15:00').Status).toBe(status);
    }
  });

  it('fills defaults for Pending and marks Present/Late', () => {
    const row = {
      CheckInTime: null as string | null,
      CheckOutTime: null as string | null,
      DefaultCheckInTime: '10:00',
      DefaultCheckOutTime: '22:00',
      ScheduledStartTime: '10:00',
      ScheduledEndTime: '22:00',
      Status: 'Pending',
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
    };
    const updated = applyDefaultTimesToRow(row);
    expect(updated.CheckInTime).toBe('10:00');
    expect(updated.CheckOutTime).toBe('22:00');
    expect(updated.Status).toBe('Present');
  });
});
