/**
 * Tests for HR expand-only attendance → schedule overrides
 * + applyOverrides widen-after-ops behavior.
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
vi.mock('@/lib/scheduleOverrides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scheduleOverrides')>();
  return {
    ...actual,
    ensureOverridesTable: (...args: unknown[]) => ensureOverridesTable(...args),
  };
});

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
  calcLateLeaveMinutes,
  planAttendanceShiftOverrides,
  syncAttendanceShiftToOverrides,
} from '@/lib/hr/attendance-shift-schedule-sync';
import {
  ATTENDANCE_SHIFT_OVERRIDE_SOURCE,
  applyOverrides,
  type ScheduleOverride,
} from '@/lib/scheduleOverrides';

function ov(
  partial: Partial<ScheduleOverride> & Pick<ScheduleOverride, 'Type'>,
): ScheduleOverride {
  return {
    OverrideID: partial.OverrideID ?? 1,
    EmpID: partial.EmpID ?? 1,
    OverrideDate: partial.OverrideDate ?? '2026-07-24',
    Type: partial.Type,
    StartTime: partial.StartTime ?? null,
    EndTime: partial.EndTime ?? null,
    Reason: partial.Reason ?? null,
    IsActive: partial.IsActive ?? true,
    CreatedAt: partial.CreatedAt ?? '2026-07-24T10:00:00',
    CreatedBy: partial.CreatedBy ?? null,
  };
}

describe('planAttendanceShiftOverrides (expand only)', () => {
  it('clears when Absent', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '09:00',
        checkOutTime: '20:00',
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Absent',
      }),
    ).toEqual({ action: 'clear' });
  });

  it('does NOT close slots for late check-in', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '11:00',
        checkOutTime: null,
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Late',
      }),
    ).toEqual({ action: 'clear' });
  });

  it('does NOT close slots for early leave', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '10:00',
        checkOutTime: '16:00',
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'EarlyLeave',
      }),
    ).toEqual({ action: 'clear' });
  });

  it('opens earlier slots on early arrival', () => {
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
          endTime: null,
          reason: 'حضور مبكر — فتح مواعيد أبكر',
        },
      ],
    });
  });

  it('opens later slots when check-out is after scheduled end', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '10:00',
        checkOutTime: '20:00',
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        status: 'Present',
      }),
    ).toEqual({
      action: 'apply',
      overrides: [
        {
          type: 'custom_hours',
          startTime: null,
          endTime: '20:00',
          reason: 'انصراف متأخر 120 د — فتح مواعيد بعد الشيفت',
        },
      ],
    });
  });

  it('opens both ends when early in and late out', () => {
    expect(
      planAttendanceShiftOverrides({
        checkInTime: '09:00',
        checkOutTime: '20:00',
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
          endTime: '20:00',
          reason: 'حضور مبكر + انصراف متأخر من الحضور — فتح مواعيد',
        },
      ],
    });
  });

  it('clears when on-time window', () => {
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

describe('calcLateLeaveMinutes', () => {
  it('returns minutes past end', () => {
    expect(calcLateLeaveMinutes('19:30', '18:00', '10:00')).toBe(90);
    expect(calcLateLeaveMinutes('18:00', '18:00', '10:00')).toBe(0);
    expect(calcLateLeaveMinutes('16:00', '18:00', '10:00')).toBe(0);
  });
});

describe('applyOverrides: default + ops close + attendance open', () => {
  const base = { isWorking: true, start: '10:00', end: '18:00' };

  it('keeps default when no overrides', () => {
    const eff = applyOverrides(1, '2026-07-24', base, []);
    expect(eff.start).toBe('10:00');
    expect(eff.end).toBe('18:00');
  });

  it('ops late_start closes morning slots', () => {
    const eff = applyOverrides(1, '2026-07-24', base, [
      ov({
        Type: 'late_start',
        StartTime: '12:00',
        CreatedBy: 'schedule-control',
      }),
    ]);
    expect(eff.start).toBe('12:00');
    expect(eff.end).toBe('18:00');
  });

  it('attendance early arrival opens earlier than default', () => {
    const eff = applyOverrides(1, '2026-07-24', base, [
      ov({
        Type: 'custom_hours',
        StartTime: '09:00',
        EndTime: null,
        CreatedBy: ATTENDANCE_SHIFT_OVERRIDE_SOURCE,
      }),
    ]);
    expect(eff.start).toBe('09:00');
    expect(eff.end).toBe('18:00');
  });

  it('attendance early reopens slots closed by ops late_start', () => {
    const eff = applyOverrides(1, '2026-07-24', base, [
      ov({
        OverrideID: 1,
        Type: 'late_start',
        StartTime: '12:00',
        CreatedBy: 'schedule-control',
      }),
      ov({
        OverrideID: 2,
        Type: 'custom_hours',
        StartTime: '09:30',
        EndTime: null,
        CreatedBy: ATTENDANCE_SHIFT_OVERRIDE_SOURCE,
      }),
    ]);
    expect(eff.start).toBe('09:30');
    expect(eff.end).toBe('18:00');
  });

  it('attendance late leave opens after scheduled end', () => {
    const eff = applyOverrides(1, '2026-07-24', base, [
      ov({
        Type: 'custom_hours',
        StartTime: null,
        EndTime: '20:00',
        CreatedBy: ATTENDANCE_SHIFT_OVERRIDE_SOURCE,
      }),
    ]);
    expect(eff.start).toBe('10:00');
    expect(eff.end).toBe('20:00');
  });

  it('attendance late leave reopens past ops early_leave', () => {
    const eff = applyOverrides(1, '2026-07-24', base, [
      ov({
        OverrideID: 1,
        Type: 'early_leave',
        EndTime: '16:00',
        CreatedBy: 'schedule-control',
      }),
      ov({
        OverrideID: 2,
        Type: 'custom_hours',
        StartTime: null,
        EndTime: '19:00',
        CreatedBy: ATTENDANCE_SHIFT_OVERRIDE_SOURCE,
      }),
    ]);
    expect(eff.start).toBe('10:00');
    expect(eff.end).toBe('19:00');
  });

  it('attendance-tagged custom_hours does not replace like ops custom_hours', () => {
    // Without expand intent vs base (start=10 = base), must not undo ops late_start
    const eff = applyOverrides(1, '2026-07-24', base, [
      ov({
        OverrideID: 1,
        Type: 'late_start',
        StartTime: '12:00',
        CreatedBy: 'schedule-control',
      }),
      ov({
        OverrideID: 2,
        Type: 'custom_hours',
        StartTime: '10:00',
        EndTime: '18:00',
        CreatedBy: ATTENDANCE_SHIFT_OVERRIDE_SOURCE,
      }),
    ]);
    expect(eff.start).toBe('12:00');
    expect(eff.end).toBe('18:00');
  });
});

describe('loadBookingOverridesForDate (canonical)', () => {
  it('is exported for booking/ops window resolution', async () => {
    const mod = await import('@/lib/hr/attendance-shift-schedule-sync');
    expect(typeof mod.loadBookingOverridesForDate).toBe('function');
    expect(typeof mod.loadBookingOverridesForBarber).toBe('function');
  });
});

describe('syncAttendanceShiftToOverrides', () => {
  beforeEach(() => {
    ensureOverridesTable.mockClear();
  });

  it('inserts expand custom_hours for early arrival', async () => {
    const db = makeRecordingDb([{ rowsAffected: [1] }, { rowsAffected: [1] }]);

    const result = await syncAttendanceShiftToOverrides(db, 7, '2026-07-24', {
      checkInTime: '09:00',
      checkOutTime: null,
      scheduledStart: '10:00',
      scheduledEnd: '18:00',
      status: 'Present',
    });

    expect(result.inserted).toBe(1);
    expect(db.calls[1].inputs.type).toBe('custom_hours');
    expect(db.calls[1].inputs.startT).toBe('09:00');
    expect(db.calls[1].inputs.endT).toBeNull();
    expect(db.calls[1].inputs.createdBy).toBe(ATTENDANCE_SHIFT_SOURCE);
  });

  it('only deactivates when on-time (no expand)', async () => {
    const db = makeRecordingDb([{ rowsAffected: [2] }]);

    const result = await syncAttendanceShiftToOverrides(db, 3, '2026-07-24', {
      checkInTime: '11:00',
      checkOutTime: null,
      scheduledStart: '10:00',
      scheduledEnd: '18:00',
      status: 'Late',
    });

    expect(result).toEqual({
      deactivated: 2,
      inserted: 0,
      plan: { action: 'clear' },
    });
  });
});
