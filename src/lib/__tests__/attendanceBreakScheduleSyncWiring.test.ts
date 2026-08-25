/**
 * Wiring tests: schedule-control apply/delete and attendance PUT
 * must call the break ↔ block_range sync helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const syncBreakFromBlockRange = vi.fn(async () => ({ attendanceId: 1, added: true }));
const removeBreakMatchingBlockRange = vi.fn(async () => ({ removed: true }));
const removeBreakTimeMatchingBlockRange = vi.fn(async () => ({ removed: false }));
const syncBlockRangesFromBreaks = vi.fn(async () => ({ deactivated: 0, inserted: 1 }));
const syncBlockRangesFromBreakTimes = vi.fn(async () => ({ deactivated: 0, inserted: 1 }));
const isSyncedBlockRangeCreatedBy = vi.fn((createdBy: string | null | undefined) => {
  if (!createdBy) return false;
  return (
    createdBy === 'attendance-break' ||
    createdBy === 'attendance-break-time' ||
    createdBy.startsWith('schedule-control block_range')
  );
});

vi.mock('@/lib/hr/attendance-break-schedule-sync', () => ({
  syncBreakFromBlockRange: (...args: unknown[]) => syncBreakFromBlockRange(...args),
  removeBreakMatchingBlockRange: (...args: unknown[]) => removeBreakMatchingBlockRange(...args),
  removeBreakTimeMatchingBlockRange: (...args: unknown[]) =>
    removeBreakTimeMatchingBlockRange(...args),
  syncBlockRangesFromBreaks: (...args: unknown[]) => syncBlockRangesFromBreaks(...args),
  syncBlockRangesFromBreakTimes: (...args: unknown[]) => syncBlockRangesFromBreakTimes(...args),
  isSyncedBlockRangeCreatedBy: (...args: unknown[]) => isSyncedBlockRangeCreatedBy(...args),
  SC_BLOCK_RANGE_SOURCE: 'schedule-control block_range',
  ATTENDANCE_BREAK_SOURCE: 'attendance-break',
  ATTENDANCE_BREAK_TIME_SOURCE: 'attendance-break-time',
}));

const syncAttendanceShiftToOverrides = vi.fn(async () => ({
  deactivated: 0,
  inserted: 0,
  plan: { action: 'clear' as const },
}));
const syncAttendanceAbsenceToDayOffOverride = vi.fn(async () => ({
  cleared: 0,
  ensured: false,
}));

vi.mock('@/lib/hr/attendance-shift-schedule-sync', () => ({
  syncAttendanceShiftToOverrides: (...args: unknown[]) =>
    syncAttendanceShiftToOverrides(...args),
  syncAttendanceAbsenceToDayOffOverride: (...args: unknown[]) =>
    syncAttendanceAbsenceToDayOffOverride(...args),
  ATTENDANCE_SHIFT_SOURCE: 'attendance-shift',
}));

vi.mock('@/lib/branch', () => ({
  isActiveBranchContext: vi.fn((b: unknown) => !!b),
  requireBranchOperationAccess: vi.fn(async () => ({
    ok: true,
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'Gleem',
  })),
}));

vi.mock('@/lib/hr/attendance/branchAttendance.service', () => ({
  assertEmployeeEligibleForBranchAttendance: vi.fn(async () => undefined),
}));

vi.mock('@/lib/hr/empBranchWorkDayClose.service', () => ({
  assertEmpBranchWorkDayMutable: vi.fn(async () => undefined),
}));

const ensureOverridesTable = vi.fn(async () => undefined);
vi.mock('@/lib/scheduleOverrides', () => ({
  ensureOverridesTable: (...args: unknown[]) => ensureOverridesTable(...args),
}));

const getScheduleOverrides = vi.fn(async () => []);
const getBarberDayStatus = vi.fn(async () => ({
  dateStr: '2026-07-15',
  isWorkingDay: true,
  isDayOff: false,
  isAbsent: false,
  isLateStart: false,
  isEarlyLeave: false,
  isCustomHours: false,
  effectiveStart: '12:00',
  effectiveEnd: '00:00',
  statusReasonArabic: 'متاح',
  currentAvailabilityStatus: 'working',
  appliedOverride: null,
  attendance: null,
}));
const cairoDateStr = vi.fn(() => '2026-07-15');

vi.mock('@/lib/availabilityEngine', () => ({
  getScheduleOverrides: (...args: unknown[]) => getScheduleOverrides(...args),
  getBarberDayStatus: (...args: unknown[]) => getBarberDayStatus(...args),
  cairoDateStr: (...args: unknown[]) => cairoDateStr(...args),
}));

const computePreview = vi.fn(async () => ({
  safe: true,
  affectedBookings: [],
  affectedQueueTickets: [],
  warnings: [],
  oldEffectiveStart: '12:00',
  oldEffectiveEnd: '00:00',
  newEffectiveStart: '12:00',
  newEffectiveEnd: '00:00',
}));

vi.mock('@/lib/scheduleControlPreview', () => ({
  computePreview: (...args: unknown[]) => computePreview(...args),
}));

const replaceAttendanceBreaks = vi.fn(async () => 60);
const ensureAttendanceBreakSchema = vi.fn(async () => undefined);
const loadBreaksByAttendanceIds = vi.fn(async () => new Map());

vi.mock('@/lib/hr/attendance-breaks-db', () => ({
  ensureAttendanceBreakSchema: (...args: unknown[]) => ensureAttendanceBreakSchema(...args),
  replaceAttendanceBreaks: (...args: unknown[]) => replaceAttendanceBreaks(...args),
  loadBreaksByAttendanceIds: (...args: unknown[]) => loadBreaksByAttendanceIds(...args),
}));

const replaceAttendanceBreakTimes = vi.fn(async () => 0);
const ensureAttendanceBreakTimeSchema = vi.fn(async () => undefined);
const loadBreakTimesByAttendanceIds = vi.fn(async () => new Map());

vi.mock('@/lib/hr/attendance-break-time-db', () => ({
  ensureAttendanceBreakTimeSchema: (...args: unknown[]) => ensureAttendanceBreakTimeSchema(...args),
  replaceAttendanceBreakTimes: (...args: unknown[]) => replaceAttendanceBreakTimes(...args),
  loadBreakTimesByAttendanceIds: (...args: unknown[]) => loadBreakTimesByAttendanceIds(...args),
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ UserID: 1, UserName: 'Admin', UserLevel: 1 })),
}));

vi.mock('@/lib/hr/attendance-eligibility', () => ({
  computeAttendanceSummary: vi.fn(() => ({})),
  filterAttendanceBoardRows: vi.fn((rows: unknown) => rows),
  resolveScheduleForDay: vi.fn(() => ({
    scheduledStart: '12:00',
    scheduledEnd: '00:00',
  })),
}));

vi.mock('@/lib/hr/employee-hr-model', () => ({
  normalizeEmploymentType: vi.fn(() => 'full_time'),
}));

vi.mock('@/lib/timeUtils', () => ({
  calcLateMinutes: vi.fn(() => 0),
  calcEarlyLeaveMinutes: vi.fn(() => 0),
}));

vi.mock('@/lib/services/employeeAttendanceWhatsAppNotify', () => ({
  scheduleAttendanceCheckInOutWhatsApp: vi.fn(),
}));

// schedule-control apply/DELETE fire-and-forget notifyHotEffectiveDay → MERGE
// TblBookingAvailabilityRevision on the shared getPool mock. Without this mock,
// that async work races into later tests and shifts the sequential query queue
// (stale wiring failure: PUT 500 reading undefined ID / recordset[0]).
vi.mock('@/lib/booking/cache/hotCacheInvalidateBestEffort', () => ({
  notifyHotEffectiveDay: vi.fn(async () => undefined),
  notifyHotWeeklyBaseline: vi.fn(async () => undefined),
  notifyHotQueueChanged: vi.fn(async () => undefined),
  notifyHotBranchHours: vi.fn(async () => undefined),
  bookingHorizonDates: vi.fn(() => []),
}));

type QueryResult = { recordset?: unknown[]; rowsAffected?: number[] };

let queryQueue: QueryResult[] = [];
let queryIdx = 0;

/** Optional SQL-aware stubs for admin PUT (ignore unrelated MERGE / noise). */
let putSqlStubs: {
  peek?: QueryResult;
  schedule?: QueryResult;
  write?: QueryResult;
} | null = null;

function resolveQuery(sqlText: string): QueryResult {
  const sql = String(sqlText);
  if (putSqlStubs) {
    if (/TblBookingAvailabilityRevision/i.test(sql)) {
      return { recordset: [], rowsAffected: [1] };
    }
    if (/IF NOT EXISTS[\s\S]*TblEmpAttendance/i.test(sql)) {
      return { recordset: [] };
    }
    if (
      /SELECT\s+ID[\s\S]*CheckInTime[\s\S]*FROM\s+dbo\.TblEmpAttendance/i.test(sql)
    ) {
      return putSqlStubs.peek ?? { recordset: [] };
    }
    if (/EmpName[\s\S]*EmploymentType[\s\S]*OUTER APPLY/i.test(sql)) {
      return putSqlStubs.schedule ?? { recordset: [] };
    }
    if (/UPDATE\s+dbo\.TblEmpAttendance/i.test(sql)) {
      return putSqlStubs.write ?? { rowsAffected: [1] };
    }
    if (/INSERT\s+INTO\s+dbo\.TblEmpAttendance/i.test(sql)) {
      return putSqlStubs.write ?? { recordset: [{ ID: 88 }] };
    }
  }
  const res = queryQueue[queryIdx] ?? { recordset: [], rowsAffected: [1] };
  queryIdx += 1;
  return res;
}

function makeFakeDb() {
  return {
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async (sqlText: string) => resolveQuery(sqlText)),
    })),
  };
}

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => makeFakeDb()),
  sql: {
    Int: 'Int',
    Date: 'Date',
    Time: 'Time',
    NVarChar: (n: number) => `NVarChar(${n})`,
    TinyInt: 'TinyInt',
    Request: class {},
  },
}));

function jsonReq(url: string, body: unknown, method = 'PUT') {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryQueue = [];
  queryIdx = 0;
  putSqlStubs = null;
  cairoDateStr.mockReturnValue('2026-07-15');
  getScheduleOverrides.mockResolvedValue([]);
  computePreview.mockResolvedValue({
    safe: true,
    affectedBookings: [],
    affectedQueueTickets: [],
    warnings: [],
    oldEffectiveStart: '12:00',
    oldEffectiveEnd: '00:00',
    newEffectiveStart: '12:00',
    newEffectiveEnd: '00:00',
  });
  getBarberDayStatus.mockResolvedValue({
    dateStr: '2026-07-15',
    isWorkingDay: true,
    isDayOff: false,
    isAbsent: false,
    isLateStart: false,
    isEarlyLeave: false,
    isCustomHours: false,
    effectiveStart: '12:00',
    effectiveEnd: '00:00',
    statusReasonArabic: 'متاح',
    currentAvailabilityStatus: 'working',
    appliedOverride: null,
    attendance: null,
  });
});

describe('POST /api/operations/schedule-control/apply wiring', () => {
  it('calls syncBreakFromBlockRange when applying block_range', async () => {
    // Insert override returns OverrideID
    queryQueue = [{ recordset: [{ OverrideID: 99 }] }];

    const { POST } = await import('@/app/api/operations/schedule-control/apply/route');
    const res = await POST(
      jsonReq('http://localhost/api/operations/schedule-control/apply', {
        empId: 5,
        date: '2026-07-15',
        type: 'block_range',
        startTime: '14:00',
        endTime: '15:00',
        reason: 'كافي',
      }, 'POST'),
    );

    expect(res.status).toBe(200);
    expect(syncBreakFromBlockRange).toHaveBeenCalledWith(
      expect.anything(),
      5,
      '2026-07-15',
      '14:00',
      '15:00',
      'كافي',
      1,
    );
  });

  it('does not call break sync for late_start', async () => {
    queryQueue = [{ recordset: [{ OverrideID: 100 }] }];

    const { POST } = await import('@/app/api/operations/schedule-control/apply/route');
    const res = await POST(
      jsonReq('http://localhost/api/operations/schedule-control/apply', {
        empId: 5,
        date: '2026-07-15',
        type: 'late_start',
        startTime: '14:00',
      }, 'POST'),
    );

    expect(res.status).toBe(200);
    expect(syncBreakFromBlockRange).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/operations/schedule-control/override/[id] wiring', () => {
  it('removes matching attendance break for synced block_range', async () => {
    queryQueue = [
      {
        recordset: [
          {
            EmpID: 5,
            OverrideDate: '2026-07-15',
            Type: 'block_range',
            CreatedBy: 'schedule-control block_range',
            StartTime: '14:00',
            EndTime: '15:00',
          },
        ],
      },
      { rowsAffected: [1] }, // soft-delete
    ];

    const { DELETE } = await import(
      '@/app/api/operations/schedule-control/override/[id]/route'
    );
    const res = await DELETE(
      new NextRequest('http://localhost/api/operations/schedule-control/override/42', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: '42' }) },
    );

    expect(res.status).toBe(200);
    expect(removeBreakMatchingBlockRange).toHaveBeenCalledWith(
      expect.anything(),
      5,
      '2026-07-15',
      '14:00',
      '15:00',
    );
  });

  it('skips break removal for non-synced CreatedBy', async () => {
    isSyncedBlockRangeCreatedBy.mockReturnValueOnce(false);
    queryQueue = [
      {
        recordset: [
          {
            EmpID: 5,
            OverrideDate: '2026-07-15',
            Type: 'block_range',
            CreatedBy: 'manual-ops',
            StartTime: '14:00',
            EndTime: '15:00',
          },
        ],
      },
      { rowsAffected: [1] },
    ];

    const { DELETE } = await import(
      '@/app/api/operations/schedule-control/override/[id]/route'
    );
    await DELETE(
      new NextRequest('http://localhost/api/operations/schedule-control/override/43', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: '43' }) },
    );

    expect(removeBreakMatchingBlockRange).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/attendance wiring', () => {
  it('calls syncBlockRangesFromBreaks after saving breaks', async () => {
    // SQL-dispatch stubs (not a brittle sequential queue): schedule-control tests
    // previously left fire-and-forget MERGE on the shared getPool mock, which
    // shifted a fixed queue and made this look like a 500 / missing ID bug.
    // Production path is correct when branch + closed punch + existing row.
    putSqlStubs = {
      peek: { recordset: [{ ID: 88, CheckInTime: '12:00', CheckOutTime: null }] },
      schedule: {
        recordset: [
          {
            EmpName: 'Test',
            EmploymentType: 'full_time',
            DefaultCheckInTime: '12:00',
            DefaultCheckOutTime: '00:00',
            ScheduleDayOfWeek: 3,
            IsWorkingDay: true,
            ScheduleStartTime: '12:00',
            ScheduleEndTime: '00:00',
          },
        ],
      },
      write: { rowsAffected: [1] },
    };

    const { PUT } = await import('@/app/api/admin/attendance/route');
    const res = await PUT(
      jsonReq('http://localhost/api/admin/attendance', {
        EmpID: 5,
        WorkDate: '2026-07-15',
        CheckInTime: '12:00',
        CheckOutTime: '22:00',
        Status: 'Present',
        Breaks: [{ LeaveAt: '14:00', ReturnAt: '15:00' }],
      }),
    );

    expect(res.status).toBe(200);
    expect(replaceAttendanceBreaks).toHaveBeenCalled();
    expect(syncBlockRangesFromBreaks).toHaveBeenCalledWith(
      expect.anything(),
      5,
      '2026-07-15',
      [
        expect.objectContaining({
          LeaveAt: '14:00',
          ReturnAt: '15:00',
          Minutes: 60,
        }),
      ],
    );
    expect(syncAttendanceShiftToOverrides).toHaveBeenCalledWith(
      expect.anything(),
      5,
      '2026-07-15',
      expect.objectContaining({
        checkInTime: '12:00',
        checkOutTime: '22:00',
        scheduledStart: '12:00',
        scheduledEnd: '00:00',
        status: 'Present',
      }),
    );
    expect(syncAttendanceAbsenceToDayOffOverride).toHaveBeenCalledWith(
      expect.anything(),
      5,
      '2026-07-15',
      'Present',
    );
  });
});
