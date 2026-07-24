/**
 * Tests for HR check-in/out → schedule override mirror (available-slots window).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'Int',
    Date: 'Date',
    NVarChar: (n: number) => `NVarChar(${n})`,
    Request: class {},
  },
}));

const ensureOverridesTable = vi.fn(async () => undefined);
vi.mock('@/lib/scheduleOverrides', () => ({
  ensureOverridesTable: (...args: unknown[]) => ensureOverridesTable(...args),
}));

type CapturedQuery = {
  sql: string;
  inputs: Record<string, unknown>;
};

function makeRecordingDb(queue: Array<{ recordset?: unknown[]; rowsAffected?: number[] }>) {
  const calls: CapturedQuery[] = [];
  let idx = 0;

  return {
    calls,
    request() {
      const inputs: Record<string, unknown> = {};
      return {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return this;
        },
        async query(sqlText: string) {
          calls.push({ sql: sqlText, inputs: { ...inputs } });
          const res = queue[idx] ?? { recordset: [], rowsAffected: [0] };
          idx += 1;
          return res;
        },
      };
    },
  };
}

import {
  ATTENDANCE_SHIFT_SOURCE,
  planAttendanceShiftOverrides,
  syncAttendanceShiftToOverrides,
} from '@/lib/hr/attendance-shift-schedule-sync';

describe('planAttendanceShiftOverrides', () => {
  it('clears when Absent / DayOff / Excused', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '11:00',
        checkOutTime: null,
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Absent',
      }),
    ).toEqual({ action: 'clear' });
  });

  it('plans late_start when check-in is after scheduled start', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '10:45',
        checkOutTime: null,
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Late',
      }),
    ).toEqual({
      action: 'apply',
      overrides: [
        {
          type: 'late_start',
          startTime: '10:45',
          endTime: null,
          reason: 'تأخير 45 د من الحضور',
        },
      ],
    });
  });

  it('plans custom_hours when employee arrives early (opens earlier slots)', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '09:00',
        checkOutTime: null,
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Present',
      }),
    ).toEqual({
      action: 'apply',
      overrides: [
        {
          type: 'custom_hours',
          startTime: '09:00',
          endTime: '18:00',
          reason: 'حضور مبكر — فتح مواعيد أبكر',
        },
      ],
    });
  });

  it('plans late_start + early_leave together', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '10:30',
        checkOutTime: '16:00',
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Late',
      }),
    ).toEqual({
      action: 'apply',
      overrides: [
        {
          type: 'late_start',
          startTime: '10:30',
          endTime: null,
          reason: 'تأخير 30 د من الحضور',
        },
        {
          type: 'early_leave',
          startTime: null,
          endTime: '16:00',
          reason: 'انصراف مبكر من الحضور',
        },
      ],
    });
  });

  it('plans custom_hours with early leave end when both early arrival and early leave', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '09:00',
        checkOutTime: '16:00',
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Present',
      }),
    ).toEqual({
      action: 'apply',
      overrides: [
        {
          type: 'custom_hours',
          startTime: '09:00',
          endTime: '16:00',
          reason: 'حضور مبكر + انصراف مبكر من الحضور',
        },
      ],
    });
  });

  it('clears when on-time with no early leave', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '10:00',
        checkOutTime: '18:00',
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Present',
      }),
    ).toEqual({ action: 'clear' });
  });
});

describe('syncAttendanceShiftToOverrides', () => {
  beforeEach(() => {
    ensureOverridesTable.mockClear();
  });

  it('deactivates attendance-shift rows then inserts late_start', async () => {
    const db = makeRecordingDb([
      { rowsAffected: [1] }, // deactivate
      { rowsAffected: [1] }, // insert
    ]);

    const result = await syncAttendanceShiftToOverrides(db, 7, '2026-07-24', {
      checkInTime: '11:00',
      checkOutTime: null,
      scheduledStart: '10:00',
      scheduledEnd: '18:00',
      status: 'Late',
    });

    expect(ensureOverridesTable).toHaveBeenCalled();
    expect(result.deactivated).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.plan.action).toBe('apply');

    expect(db.calls[0].inputs.src).toBe(ATTENDANCE_SHIFT_SOURCE);
    expect(db.calls[0].sql).toContain('IsActive = 0');
    expect(db.calls[1].inputs.type).toBe('late_start');
    expect(db.calls[1].inputs.startT).toBe('11:00');
    expect(db.calls[1].inputs.createdBy).toBe(ATTENDANCE_SHIFT_SOURCE);
  });

  it('only deactivates when plan is clear', async () => {
    const db = makeRecordingDb([{ rowsAffected: [2] }]);

    const result = await syncAttendanceShiftToOverrides(db, 3, '2026-07-24', {
      checkInTime: '10:00',
      checkOutTime: null,
      scheduledStart: '10:00',
      scheduledEnd: '18:00',
      status: 'Present',
    });

    expect(result).toEqual({
      deactivated: 2,
      inserted: 0,
      plan: { action: 'clear' },
    });
    expect(db.calls).toHaveLength(1);
  });
});
