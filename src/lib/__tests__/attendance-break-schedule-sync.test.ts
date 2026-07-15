/**
 * Tests for وقت مستقطع ↔ block_range bidirectional sync.
 * Covers pure helpers + DB sync flows with mocked dependencies.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'Int',
    Date: 'Date',
    NVarChar: (n: number) => `NVarChar(${n})`,
    Time: 'Time',
    Request: class {},
  },
}));

const ensureOverridesTable = vi.fn(async () => undefined);
vi.mock('@/lib/scheduleOverrides', () => ({
  ensureOverridesTable: (...args: unknown[]) => ensureOverridesTable(...args),
}));

const ensureAttendanceBreakSchema = vi.fn(async () => undefined);
const loadBreaksByAttendanceIds = vi.fn(async () => new Map());
const replaceAttendanceBreaks = vi.fn(async () => 0);

vi.mock('@/lib/hr/attendance-breaks-db', () => ({
  ensureAttendanceBreakSchema: (...args: unknown[]) => ensureAttendanceBreakSchema(...args),
  loadBreaksByAttendanceIds: (...args: unknown[]) => loadBreaksByAttendanceIds(...args),
  replaceAttendanceBreaks: (...args: unknown[]) => replaceAttendanceBreaks(...args),
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
  ATTENDANCE_BREAK_SOURCE,
  SC_BLOCK_RANGE_SOURCE,
  breaksToSyncableIntervals,
  intervalKey,
  isSameDayBlockInterval,
  isSyncedBlockRangeCreatedBy,
  removeBreakMatchingBlockRange,
  syncBlockRangesFromBreaks,
  syncBreakFromBlockRange,
} from '@/lib/hr/attendance-break-schedule-sync';

describe('helpers: isSyncedBlockRangeCreatedBy', () => {
  it('matches attendance-break and schedule-control tags', () => {
    expect(isSyncedBlockRangeCreatedBy(ATTENDANCE_BREAK_SOURCE)).toBe(true);
    expect(isSyncedBlockRangeCreatedBy(SC_BLOCK_RANGE_SOURCE)).toBe(true);
    expect(isSyncedBlockRangeCreatedBy(`${SC_BLOCK_RANGE_SOURCE}: coffee`)).toBe(true);
    expect(isSyncedBlockRangeCreatedBy('manual')).toBe(false);
    expect(isSyncedBlockRangeCreatedBy(null)).toBe(false);
  });
});

describe('helpers: isSameDayBlockInterval', () => {
  it('accepts leave before return', () => {
    expect(isSameDayBlockInterval('14:00', '15:30')).toBe(true);
    expect(isSameDayBlockInterval('9:00', '10:00')).toBe(true);
  });

  it('rejects overnight / equal / invalid', () => {
    expect(isSameDayBlockInterval('23:00', '01:00')).toBe(false);
    expect(isSameDayBlockInterval('14:00', '14:00')).toBe(false);
    expect(isSameDayBlockInterval('14:00', null)).toBe(false);
    expect(isSameDayBlockInterval(null, '15:00')).toBe(false);
  });
});

describe('helpers: breaksToSyncableIntervals', () => {
  it('keeps same-day breaks only and normalizes times', () => {
    const intervals = breaksToSyncableIntervals([
      { LeaveAt: '14:00', ReturnAt: '15:00', Minutes: 60, Notes: 'راحة' },
      { LeaveAt: '23:00', ReturnAt: '01:00', Minutes: 120 },
      { LeaveAt: '9:05', ReturnAt: '9:35' },
    ]);
    expect(intervals).toEqual([
      { startTime: '14:00', endTime: '15:00', minutes: 60, notes: 'راحة' },
      { startTime: '09:05', endTime: '09:35', minutes: 30, notes: null },
    ]);
  });
});

describe('helpers: intervalKey', () => {
  it('normalizes to HH:MM keys', () => {
    expect(intervalKey('9:00', '10:30')).toBe('09:00-10:30');
  });
});

describe('syncBlockRangesFromBreaks (HR → Ops)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deactivates synced overrides then inserts one block_range per same-day break', async () => {
    const db = makeRecordingDb([
      { rowsAffected: [2] }, // deactivate
      { rowsAffected: [1] }, // insert 1
      { rowsAffected: [1] }, // insert 2
    ]);

    const result = await syncBlockRangesFromBreaks(db, 7, '2026-07-15', [
      { LeaveAt: '14:00', ReturnAt: '15:00', Minutes: 60, Notes: 'استراحة' },
      { LeaveAt: '23:00', ReturnAt: '01:00', Minutes: 120 }, // overnight skipped
      { LeaveAt: '16:00', ReturnAt: '16:30', Minutes: 30 },
    ]);

    expect(ensureOverridesTable).toHaveBeenCalledOnce();
    expect(result).toEqual({ deactivated: 2, inserted: 2 });

    expect(db.calls[0].sql).toContain('SET IsActive = 0');
    expect(db.calls[0].inputs).toMatchObject({
      empId: 7,
      odate: '2026-07-15',
      attSrc: ATTENDANCE_BREAK_SOURCE,
      scSrc: SC_BLOCK_RANGE_SOURCE,
    });

    expect(db.calls[1].sql).toContain("N'block_range'");
    expect(db.calls[1].inputs).toMatchObject({
      empId: 7,
      startT: '14:00',
      endT: '15:00',
      reason: 'استراحة',
      createdBy: ATTENDANCE_BREAK_SOURCE,
    });

    expect(db.calls[2].inputs).toMatchObject({
      startT: '16:00',
      endT: '16:30',
      reason: 'وقت مستقطع',
      createdBy: ATTENDANCE_BREAK_SOURCE,
    });
  });

  it('inserts nothing when breaks list is empty (still deactivates)', async () => {
    const db = makeRecordingDb([{ rowsAffected: [1] }]);
    const result = await syncBlockRangesFromBreaks(db, 3, '2026-07-15', []);
    expect(result).toEqual({ deactivated: 1, inserted: 0 });
    expect(db.calls).toHaveLength(1);
  });
});

describe('syncBreakFromBlockRange (Ops → HR)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates attendance row + appends break when missing', async () => {
    const db = makeRecordingDb([
      { recordset: [] }, // no attendance yet
      { recordset: [{ ID: 101 }] }, // insert attendance
    ]);
    loadBreaksByAttendanceIds.mockResolvedValueOnce(new Map([[101, []]]));
    replaceAttendanceBreaks.mockResolvedValueOnce(45);

    const result = await syncBreakFromBlockRange(
      db,
      5,
      '2026-07-15',
      '14:00',
      '14:45',
      'كافي',
    );

    expect(ensureAttendanceBreakSchema).toHaveBeenCalledOnce();
    expect(result).toEqual({ attendanceId: 101, added: true });
    expect(replaceAttendanceBreaks).toHaveBeenCalledWith(
      db,
      101,
      [
        expect.objectContaining({
          LeaveAt: '14:00',
          ReturnAt: '14:45',
          Minutes: 45,
          Notes: `${SC_BLOCK_RANGE_SOURCE}: كافي`,
        }),
      ],
    );
  });

  it('does not duplicate an existing matching interval', async () => {
    const db = makeRecordingDb([{ recordset: [{ ID: 55 }] }]);
    loadBreaksByAttendanceIds.mockResolvedValueOnce(
      new Map([
        [
          55,
          [{ LeaveAt: '14:00', ReturnAt: '15:00', Minutes: 60, Notes: null }],
        ],
      ]),
    );

    const result = await syncBreakFromBlockRange(db, 5, '2026-07-15', '14:00', '15:00');
    expect(result).toEqual({ attendanceId: 55, added: false });
    expect(replaceAttendanceBreaks).not.toHaveBeenCalled();
  });

  it('skips overnight intervals', async () => {
    const db = makeRecordingDb([]);
    const result = await syncBreakFromBlockRange(db, 5, '2026-07-15', '23:00', '01:00');
    expect(result).toEqual({ attendanceId: 0, added: false });
    expect(replaceAttendanceBreaks).not.toHaveBeenCalled();
  });

  it('preserves existing breaks when appending', async () => {
    const db = makeRecordingDb([{ recordset: [{ ID: 77 }] }]);
    loadBreaksByAttendanceIds.mockResolvedValueOnce(
      new Map([
        [
          77,
          [{ LeaveAt: '11:00', ReturnAt: '11:30', Minutes: 30, Notes: 'قديم' }],
        ],
      ]),
    );

    await syncBreakFromBlockRange(db, 5, '2026-07-15', '16:00', '17:00');

    expect(replaceAttendanceBreaks).toHaveBeenCalledWith(
      db,
      77,
      [
        expect.objectContaining({ LeaveAt: '11:00', ReturnAt: '11:30' }),
        expect.objectContaining({
          LeaveAt: '16:00',
          ReturnAt: '17:00',
          Minutes: 60,
          Notes: SC_BLOCK_RANGE_SOURCE,
        }),
      ],
    );
  });
});

describe('removeBreakMatchingBlockRange (Ops DELETE → HR)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes matching interval and keeps others', async () => {
    const db = makeRecordingDb([{ recordset: [{ ID: 12 }] }]);
    loadBreaksByAttendanceIds.mockResolvedValueOnce(
      new Map([
        [
          12,
          [
            { LeaveAt: '14:00', ReturnAt: '15:00', Minutes: 60 },
            { LeaveAt: '16:00', ReturnAt: '16:20', Minutes: 20 },
          ],
        ],
      ]),
    );

    const result = await removeBreakMatchingBlockRange(
      db,
      9,
      '2026-07-15',
      '14:00',
      '15:00',
    );

    expect(result).toEqual({ removed: true });
    expect(replaceAttendanceBreaks).toHaveBeenCalledWith(db, 12, [
      expect.objectContaining({ LeaveAt: '16:00', ReturnAt: '16:20' }),
    ]);
  });

  it('returns removed=false when interval not found', async () => {
    const db = makeRecordingDb([{ recordset: [{ ID: 12 }] }]);
    loadBreaksByAttendanceIds.mockResolvedValueOnce(
      new Map([
        [12, [{ LeaveAt: '10:00', ReturnAt: '10:30', Minutes: 30 }]],
      ]),
    );

    const result = await removeBreakMatchingBlockRange(
      db,
      9,
      '2026-07-15',
      '14:00',
      '15:00',
    );
    expect(result).toEqual({ removed: false });
    expect(replaceAttendanceBreaks).not.toHaveBeenCalled();
  });

  it('returns removed=false when no attendance row', async () => {
    const db = makeRecordingDb([{ recordset: [] }]);
    const result = await removeBreakMatchingBlockRange(
      db,
      9,
      '2026-07-15',
      '14:00',
      '15:00',
    );
    expect(result).toEqual({ removed: false });
  });
});
