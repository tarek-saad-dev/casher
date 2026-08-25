/**
 * Characterization: schedule-control override DELETE → tagged Absent revert.
 * Freeze before Phase B6. Runtime Behavior Changes: NONE — tests only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const EMP_ID = 42;
const TODAY = '2026-08-24';
const PAST = '2026-08-01';
const SC_TAG = 'schedule-control day_off';

type AttRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string | null;
  Notes: string | null;
};

type OverrideRow = {
  OverrideID: number;
  EmpID: number;
  OverrideDate: string;
  Type: string;
  CreatedBy: string;
  StartTime: string | null;
  EndTime: string | null;
  IsActive: number;
};

const harness = vi.hoisted(() => {
  const attendance: AttRow[] = [];
  const overrides: OverrideRow[] = [];
  let nextAttId = 1;
  const capturedQueries: { sql: string; inputs: Record<string, unknown> }[] = [];
  let attendanceRevertShouldFail = false;

  function ymd(v: unknown): string {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  function makeRequest() {
    const inputs: Record<string, unknown> = {};
    return {
      input(name: string, _t: unknown, value: unknown) {
        inputs[name] = value;
        return this;
      },
      async query(sqlText: string) {
        capturedQueries.push({ sql: sqlText, inputs: { ...inputs } });
        const sql = sqlText;

        if (/FROM dbo\.TblEmpScheduleOverrides/i.test(sql) && /SELECT/i.test(sql) && /OverrideID = @oid/i.test(sql) && !/UPDATE/i.test(sql)) {
          const oid = Number(inputs.oid);
          const row = overrides.find((o) => o.OverrideID === oid);
          if (!row) return { recordset: [] };
          return {
            recordset: [
              {
                EmpID: row.EmpID,
                OverrideDate: row.OverrideDate,
                Type: row.Type,
                CreatedBy: row.CreatedBy,
                StartTime: row.StartTime,
                EndTime: row.EndTime,
              },
            ],
          };
        }

        if (/UPDATE dbo\.TblEmpScheduleOverrides/i.test(sql) && /IsActive = 0/i.test(sql)) {
          const oid = Number(inputs.oid);
          const row = overrides.find((o) => o.OverrideID === oid);
          if (row) row.IsActive = 0;
          return { recordset: [], rowsAffected: [row ? 1 : 0] };
        }

        if (
          /UPDATE dbo\.TblEmpAttendance/i.test(sql) &&
          /Status = NULL/i.test(sql) &&
          /Notes LIKE @sourceTag/i.test(sql)
        ) {
          if (attendanceRevertShouldFail) {
            throw new Error('simulated revert failure');
          }
          const empId = Number(inputs.empId);
          const workDate = ymd(inputs.workDate);
          const sourceTag = String(inputs.sourceTag);
          let n = 0;
          for (const r of attendance) {
            if (
              r.EmpID === empId &&
              r.WorkDate === workDate &&
              r.Status === 'Absent' &&
              (r.Notes ?? '').startsWith(sourceTag)
            ) {
              r.Status = null;
              r.Notes = null;
              n++;
            }
          }
          return { recordset: [], rowsAffected: [n] };
        }

        return { recordset: [], rowsAffected: [1] };
      },
    };
  }

  return {
    attendance,
    overrides,
    capturedQueries,
    cairoDateStr: vi.fn(() => TODAY),
    getBarberDayStatus: vi.fn(async () => ({
      dateStr: TODAY,
      isWorkingDay: true,
      isDayOff: false,
      isAbsent: false,
      effectiveStart: '10:00',
      effectiveEnd: '22:00',
      statusReasonArabic: 'متاح',
      currentAvailabilityStatus: 'working',
      appliedOverride: null,
      attendance: null,
    })),
    removeBreakMatchingBlockRange: vi.fn(async () => ({ removed: true })),
    removeBreakTimeMatchingBlockRange: vi.fn(async () => ({ removed: false })),
    isSyncedBlockRangeCreatedBy: vi.fn(() => false),
    notifyHotEffectiveDay: vi.fn(async () => undefined),
    setAttendanceRevertShouldFail(v: boolean) {
      attendanceRevertShouldFail = v;
    },
    reset() {
      attendance.length = 0;
      overrides.length = 0;
      capturedQueries.length = 0;
      nextAttId = 1;
      attendanceRevertShouldFail = false;
    },
    seedOverride(row: OverrideRow) {
      overrides.push(row);
      return row;
    },
    seedAtt(row: Omit<AttRow, 'ID'> & { ID?: number }) {
      const full = { ID: row.ID ?? nextAttId++, ...row };
      if (row.ID != null && row.ID >= nextAttId) nextAttId = row.ID + 1;
      attendance.push(full);
      return full;
    },
    makeRequest,
  };
});

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({ request: () => harness.makeRequest() })),
  sql: {
    Int: 'Int',
    Date: 'Date',
    NVarChar: (n: number) => `NVarChar(${n})`,
  },
}));

vi.mock('@/lib/availabilityEngine', () => ({
  cairoDateStr: (...a: unknown[]) => harness.cairoDateStr(...a),
  getBarberDayStatus: (...a: unknown[]) => harness.getBarberDayStatus(...a),
}));

vi.mock('@/lib/hr/attendance-break-schedule-sync', () => ({
  isSyncedBlockRangeCreatedBy: (...a: unknown[]) =>
    harness.isSyncedBlockRangeCreatedBy(...a),
  removeBreakMatchingBlockRange: (...a: unknown[]) =>
    harness.removeBreakMatchingBlockRange(...a),
  removeBreakTimeMatchingBlockRange: (...a: unknown[]) =>
    harness.removeBreakTimeMatchingBlockRange(...a),
}));

vi.mock('@/lib/booking/cache/hotCacheInvalidateBestEffort', () => ({
  notifyHotEffectiveDay: (...a: unknown[]) => harness.notifyHotEffectiveDay(...a),
}));

vi.mock('@/lib/businessDate', () => ({
  SALON_TZ: 'Africa/Cairo',
  getCairoBusinessDate: () => TODAY,
  getCairoTimeStr: () => '12:00',
}));

async function deleteOverride(id: number) {
  const { DELETE } = await import(
    '@/app/api/operations/schedule-control/override/[id]/route'
  );
  const req = new NextRequest(
    `http://localhost/api/operations/schedule-control/override/${id}`,
    { method: 'DELETE' },
  );
  const res = await DELETE(req, { params: Promise.resolve({ id: String(id) }) });
  const json = await res.json();
  return { status: res.status, json };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
  harness.cairoDateStr.mockReturnValue(TODAY);
  harness.getBarberDayStatus.mockResolvedValue({
    dateStr: TODAY,
    isWorkingDay: true,
    isDayOff: false,
    isAbsent: false,
    effectiveStart: '10:00',
    effectiveEnd: '22:00',
    statusReasonArabic: 'متاح',
    currentAvailabilityStatus: 'working',
    appliedOverride: null,
    attendance: null,
  });
});

describe('DELETE schedule-control/override — attendance revert characterization', () => {
  it('reverts tagged Absent today: Status/Notes → NULL (any BranchID)', async () => {
    harness.seedOverride({
      OverrideID: 7,
      EmpID: EMP_ID,
      OverrideDate: TODAY,
      Type: 'day_off',
      CreatedBy: `${SC_TAG}`,
      StartTime: null,
      EndTime: null,
      IsActive: 1,
    });
    harness.seedAtt({
      BranchID: 10,
      EmpID: EMP_ID,
      WorkDate: TODAY,
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: `${SC_TAG}: إجازة`,
    });
    harness.seedAtt({
      BranchID: 20,
      EmpID: EMP_ID,
      WorkDate: TODAY,
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: `${SC_TAG}`,
    });

    const { status, json } = await deleteOverride(7);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.attendanceReverted).toBe(true);
    expect(harness.attendance.every((r) => r.Status === null && r.Notes === null)).toBe(
      true,
    );
  });

  it('does not revert untagged / manual Absent', async () => {
    harness.seedOverride({
      OverrideID: 8,
      EmpID: EMP_ID,
      OverrideDate: TODAY,
      Type: 'day_off',
      CreatedBy: SC_TAG,
      StartTime: null,
      EndTime: null,
      IsActive: 1,
    });
    harness.seedAtt({
      BranchID: 10,
      EmpID: EMP_ID,
      WorkDate: TODAY,
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: 'manual absent',
    });
    const { json } = await deleteOverride(8);
    expect(json.attendanceReverted).toBe(false);
    expect(harness.attendance[0]).toMatchObject({
      Status: 'Absent',
      Notes: 'manual absent',
    });
  });

  it('does not revert when override date is not today', async () => {
    harness.seedOverride({
      OverrideID: 9,
      EmpID: EMP_ID,
      OverrideDate: PAST,
      Type: 'day_off',
      CreatedBy: SC_TAG,
      StartTime: null,
      EndTime: null,
      IsActive: 1,
    });
    harness.seedAtt({
      BranchID: 10,
      EmpID: EMP_ID,
      WorkDate: PAST,
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: SC_TAG,
    });
    const { json } = await deleteOverride(9);
    expect(json.attendanceReverted).toBe(false);
    expect(harness.attendance[0].Status).toBe('Absent');
  });

  it('does not revert when CreatedBy is not schedule-control day_off', async () => {
    harness.seedOverride({
      OverrideID: 10,
      EmpID: EMP_ID,
      OverrideDate: TODAY,
      Type: 'day_off',
      CreatedBy: 'manual',
      StartTime: null,
      EndTime: null,
      IsActive: 1,
    });
    harness.seedAtt({
      BranchID: 10,
      EmpID: EMP_ID,
      WorkDate: TODAY,
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: SC_TAG,
    });
    const { json } = await deleteOverride(10);
    expect(json.attendanceReverted).toBe(false);
    expect(harness.attendance[0].Status).toBe('Absent');
  });

  it('warns when day_off deleted today but Absent still present (not reverted)', async () => {
    harness.seedOverride({
      OverrideID: 11,
      EmpID: EMP_ID,
      OverrideDate: TODAY,
      Type: 'day_off',
      CreatedBy: SC_TAG,
      StartTime: null,
      EndTime: null,
      IsActive: 1,
    });
    harness.seedAtt({
      BranchID: 10,
      EmpID: EMP_ID,
      WorkDate: TODAY,
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: 'other source',
    });
    harness.getBarberDayStatus.mockResolvedValueOnce({
      dateStr: TODAY,
      isWorkingDay: false,
      isDayOff: false,
      isAbsent: true,
      effectiveStart: null,
      effectiveEnd: null,
      statusReasonArabic: 'غائب',
      currentAvailabilityStatus: 'absent',
      appliedOverride: null,
      attendance: { status: 'Absent' },
    });
    const { json } = await deleteOverride(11);
    expect(json.attendanceReverted).toBe(false);
    expect(json.attendanceWarning).toContain('حالة الحضور ما زالت غائب');
  });

  it('attendance revert SQL failure is swallowed — DELETE still 200', async () => {
    harness.seedOverride({
      OverrideID: 12,
      EmpID: EMP_ID,
      OverrideDate: TODAY,
      Type: 'day_off',
      CreatedBy: SC_TAG,
      StartTime: null,
      EndTime: null,
      IsActive: 1,
    });
    harness.seedAtt({
      BranchID: 10,
      EmpID: EMP_ID,
      WorkDate: TODAY,
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: SC_TAG,
    });
    harness.setAttendanceRevertShouldFail(true);
    const { status, json } = await deleteOverride(12);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.attendanceReverted).toBe(false);
    expect(harness.overrides[0].IsActive).toBe(0);
    expect(harness.attendance[0].Status).toBe('Absent');
  });

  it('revert SQL has no BranchID filter (EmpID + WorkDate + tag only)', async () => {
    harness.seedOverride({
      OverrideID: 13,
      EmpID: EMP_ID,
      OverrideDate: TODAY,
      Type: 'day_off',
      CreatedBy: SC_TAG,
      StartTime: null,
      EndTime: null,
      IsActive: 1,
    });
    await deleteOverride(13);
    const revertQ = harness.capturedQueries.find(
      (q) =>
        /UPDATE dbo\.TblEmpAttendance/i.test(q.sql) &&
        /Status = NULL/i.test(q.sql),
    );
    expect(revertQ).toBeTruthy();
    expect(revertQ!.sql).not.toMatch(/BranchID/i);
  });
});
