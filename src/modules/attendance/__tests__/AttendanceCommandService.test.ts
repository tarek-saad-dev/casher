/**
 * Focused unit tests for AttendanceCommandService (Phase B1).
 * Route-level contracts stay in adminAttendancePut.characterization.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAYROLL_DAY_CLOSED_CODE,
  PAYROLL_DAY_CLOSED_MESSAGE,
} from '@/lib/hr/empBranchWorkDayClose.transitions';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { resolveAdminPutAttendanceStatus } from '@/modules/attendance/domain/adminPutAttendance';

vi.mock('server-only', () => ({}));

const assertEmpBranchWorkDayMutable = vi.fn(async () => undefined);
const assertEmployeeEligibleForBranchAttendance = vi.fn(async () => undefined);
const unlockScheduleForWorkOnDayOff = vi.fn(async () => ({
  dayOffOverridesCleared: 1,
  dayOffRowsCleared: 0,
  customHours: { start: '10:00', end: '22:00' },
}));
const executeWorkOnDayOff = vi.fn(async (params: {
  empId: number;
  date: string;
  branchId: number;
  reason?: string | null;
  sourceTag?: string;
}) => {
  const unlock = await unlockScheduleForWorkOnDayOff({
    empId: params.empId,
    date: params.date,
    branchId: params.branchId,
    reason: params.reason,
    sourceTag: params.sourceTag ?? 'work-on-day-off',
  });
  const existing = store.rows.find(
    (r) =>
      r.EmpID === params.empId &&
      r.BranchID === params.branchId &&
      r.WorkDate === params.date,
  );
  if (existing) {
    existing.Status = 'Present';
    if (existing.CheckInTime == null) existing.CheckInTime = '11:30';
  } else {
    store.rows.push({
      ID: store.nextId++,
      BranchID: params.branchId,
      EmpID: params.empId,
      WorkDate: params.date,
      CheckInTime: '11:30',
      CheckOutTime: null,
      Status: 'Present',
      Notes: `${params.sourceTag ?? 'work-on-day-off'}: ${params.reason ?? ''}`,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
  }
  return {
    ok: true as const,
    message: 'تم تسجيل حضور الموظف في يوم إجازته',
    checkInTime: '11:30',
    branchId: params.branchId,
    dayOffOverridesCleared: unlock.dayOffOverridesCleared,
    dayOffRowsCleared: unlock.dayOffRowsCleared,
    customHours: unlock.customHours,
  };
});
const getBranchById = vi.fn(async (id: number) =>
  id === 10
    ? {
        branchId: 10,
        isActive: true,
        defaultOpenTime: '10:00',
        defaultCloseTime: '22:00',
      }
    : null,
);
const getBarberDayStatus = vi.fn(async () => ({
  isWorkingDay: true,
  isDayOff: false,
  isAbsent: false,
  statusReasonArabic: 'متاح',
  currentAvailabilityStatus: 'working',
  effectiveStart: '10:00',
  effectiveEnd: '22:00',
  attendance: { status: 'Present' },
}));
const notifyHotEffectiveDay = vi.fn(async () => undefined);
const getCairoTimeStr = vi.fn(() => '12:15');
const replaceAttendanceBreaks = vi.fn(async () => 0);
const replaceAttendanceBreakTimes = vi.fn(async () => 0);
const syncBlockRangesFromBreaks = vi.fn(async () => ({ deactivated: 0, inserted: 0 }));
const syncBlockRangesFromBreakTimes = vi.fn(async () => ({ deactivated: 0, inserted: 0 }));
const syncAttendanceShiftToOverrides = vi.fn(async () => ({ deactivated: 0, inserted: 0 }));
const syncAttendanceAbsenceToDayOffOverride = vi.fn(async () => ({ cleared: 0, ensured: false }));
const scheduleAttendanceCheckInOutWhatsApp = vi.fn();
const availabilityEmployeeDayChanged = vi.fn(async () => undefined);
const syncNonPostedPayrollHoursFromAttendance = vi.fn(async () => ({
  updated: false,
  payrollId: null,
  actualHours: null,
  dailyWage: null,
}));

type Row = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string | null;
  Notes: string | null;
  CreatedAt: Date;
  UpdatedAt: Date | null;
};

type EmpDefault = {
  EmpID: number;
  EmpName: string | null;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
};

const store: {
  rows: Row[];
  nextId: number;
  existingEmpIds: Set<number>;
  empDefaults: Map<number, EmpDefault>;
} = {
  rows: [],
  nextId: 1,
  existingEmpIds: new Set([42]),
  empDefaults: new Map(),
};

let txSnapshot: Row[] | null = null;

function defaultEmpMap() {
  return new Map<number, EmpDefault>([
    [
      42,
      {
        EmpID: 42,
        EmpName: 'Test Emp',
        DefaultCheckInTime: '10:00',
        DefaultCheckOutTime: '18:00',
      },
    ],
    [
      43,
      {
        EmpID: 43,
        EmpName: 'Emp B',
        DefaultCheckInTime: '10:00',
        DefaultCheckOutTime: '18:00',
      },
    ],
  ]);
}

const getEffectiveBranchScheduleRow = vi.fn(async () => ({ isWorking: true }));

vi.mock('@/lib/hr/empBranchWorkDayClose.service', () => ({
  assertEmpBranchWorkDayMutable: (...a: unknown[]) =>
    assertEmpBranchWorkDayMutable(...a),
}));
vi.mock('@/lib/hr/attendance/branchAttendance.service', () => ({
  assertEmployeeEligibleForBranchAttendance: (...a: unknown[]) =>
    assertEmployeeEligibleForBranchAttendance(...a),
}));
vi.mock('@/lib/hr/attendance/workOnDayOff.service', () => ({
  unlockScheduleForWorkOnDayOff: (...a: unknown[]) =>
    unlockScheduleForWorkOnDayOff(...a),
  executeWorkOnDayOff: (...a: unknown[]) => executeWorkOnDayOff(...(a as [never])),
}));
vi.mock('@/lib/branch/repository', () => ({
  getBranchById: (...a: unknown[]) => getBranchById(...(a as [number])),
}));
vi.mock('@/lib/businessDate', () => ({
  SALON_TZ: 'Africa/Cairo',
  getCairoTimeStr: () => getCairoTimeStr(),
  getCairoBusinessDate: () => '2026-08-24',
}));
vi.mock('@/lib/availabilityEngine', () => ({
  cairoTimeStr: () => '12:15',
  getBarberDayStatus: (...a: unknown[]) => getBarberDayStatus(...a),
}));
vi.mock('@/lib/booking/cache/hotCacheInvalidateBestEffort', () => ({
  notifyHotEffectiveDay: (...a: unknown[]) => notifyHotEffectiveDay(...a),
}));
vi.mock('@/lib/hr/empBranchWorkSchedule', () => ({
  getEffectiveBranchScheduleRow: (...a: unknown[]) =>
    getEffectiveBranchScheduleRow(...a),
}));
vi.mock('@/lib/hr/attendance-breaks-db', () => ({
  ensureAttendanceBreakSchema: vi.fn(async () => undefined),
  replaceAttendanceBreaks: (...a: unknown[]) => replaceAttendanceBreaks(...a),
  loadBreaksByAttendanceIds: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/hr/attendance-break-time-db', () => ({
  ensureAttendanceBreakTimeSchema: vi.fn(async () => undefined),
  replaceAttendanceBreakTimes: (...a: unknown[]) => replaceAttendanceBreakTimes(...a),
  loadBreakTimesByAttendanceIds: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/hr/attendance-break-schedule-sync', () => ({
  syncBlockRangesFromBreaks: (...a: unknown[]) => syncBlockRangesFromBreaks(...a),
  syncBlockRangesFromBreakTimes: (...a: unknown[]) =>
    syncBlockRangesFromBreakTimes(...a),
}));
vi.mock('@/lib/hr/attendance-shift-schedule-sync', () => ({
  syncAttendanceShiftToOverrides: (...a: unknown[]) =>
    syncAttendanceShiftToOverrides(...a),
  syncAttendanceAbsenceToDayOffOverride: (...a: unknown[]) =>
    syncAttendanceAbsenceToDayOffOverride(...a),
}));
vi.mock('@/lib/services/employeeAttendanceWhatsAppNotify', () => ({
  scheduleAttendanceCheckInOutWhatsApp: (...a: unknown[]) =>
    scheduleAttendanceCheckInOutWhatsApp(...a),
}));
vi.mock('@/lib/booking/AvailabilityMutationNotifier', () => ({
  AvailabilityMutationNotifier: {
    employeeDayChanged: (...a: unknown[]) => availabilityEmployeeDayChanged(...a),
  },
}));
vi.mock('@/lib/payroll/syncPayrollHoursFromAttendance', () => ({
  syncNonPostedPayrollHoursFromAttendance: (...a: unknown[]) =>
    syncNonPostedPayrollHoursFromAttendance(...a),
}));
vi.mock('@/lib/hr/employee-hr-model', () => ({
  normalizeEmploymentType: vi.fn(() => 'full_time'),
}));
vi.mock('@/lib/hr/attendance-eligibility', () => ({
  resolveScheduleForDay: vi.fn(() => ({
    scheduledStart: '10:00',
    scheduledEnd: '18:00',
  })),
}));
vi.mock('@/lib/timeUtils', () => ({
  calcLateMinutes: vi.fn((checkIn: string | null, schedStart?: string | null) => {
    if (!checkIn) return 0;
    const [h, m] = checkIn.split(':').map(Number);
    const mins = h * 60 + m;
    const start = schedStart || '10:00';
    const [sh, sm] = start.split(':').map(Number);
    const scheduled = sh * 60 + (sm || 0);
    return mins > scheduled ? mins - scheduled : 0;
  }),
  calcEarlyLeaveMinutes: vi.fn((checkOut: string | null, schedEnd?: string | null) => {
    if (!checkOut) return 0;
    const [h, m] = checkOut.split(':').map(Number);
    const mins = h * 60 + m;
    const end = schedEnd || '18:00';
    const [eh, em] = end.split(':').map(Number);
    const scheduled = eh * 60 + (em || 0);
    return mins < scheduled ? scheduled - mins : 0;
  }),
}));

function hhmm(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  const s = String(v);
  if (s === '') return '';
  return s.slice(0, 5);
}
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
      const sql = sqlText;
      if (/INFORMATION_SCHEMA\.TABLES/i.test(sql)) {
        return { recordset: [], rowsAffected: [1] };
      }
      if (/SELECT 1 FROM dbo\.TblEmp WHERE EmpID = @empId/i.test(sql)) {
        const empId = Number(inputs.empId);
        return {
          recordset: store.existingEmpIds.has(empId) ? [{ '': 1 }] : [],
        };
      }
      if (/FROM dbo\.TblEmp\b/i.test(sql) && /EmpID IN/i.test(sql)) {
        return { recordset: [...store.empDefaults.values()] };
      }
      if (/sp_getapplock/i.test(sql)) {
        return { recordset: [{ lockResult: 0 }], rowsAffected: [1] };
      }
      // Active-session inventory: all OPEN for EmpID
      if (
        /CheckOutTime IS NULL/i.test(sql) &&
        /EmpID = @empId/i.test(sql) &&
        /TblEmpAttendance/i.test(sql) &&
        !/BranchID\s*<>/i.test(sql) &&
        !/WorkDate = @workDate/i.test(sql)
      ) {
        const empId = Number(inputs.empId);
        const rows = store.rows.filter(
          (r) =>
            r.EmpID === empId &&
            r.CheckInTime != null &&
            r.CheckOutTime == null,
        );
        return {
          recordset: rows.map((row) => ({
            ID: row.ID,
            EmpID: row.EmpID,
            BranchID: row.BranchID,
            WorkDate: row.WorkDate,
            CheckInTime: row.CheckInTime,
          })),
        };
      }
      if (/CheckOutTime IS NULL/i.test(sql) && /BranchID\s*<>/i.test(sql)) {
        const empId = Number(inputs.empId);
        const branchId = Number(inputs.branchId);
        const row = store.rows.find(
          (r) =>
            r.EmpID === empId &&
            r.CheckInTime != null &&
            r.CheckOutTime == null &&
            r.BranchID !== branchId,
        );
        return {
          recordset: row
            ? [{ ID: row.ID, BranchID: row.BranchID, WorkDate: row.WorkDate }]
            : [],
        };
      }
      if (/FROM dbo\.TblEmp\b/i.test(sql) && /OUTER APPLY/i.test(sql)) {
        return {
          recordset: [
            {
              EmpName: 'Test Emp',
              EmploymentType: 'full_time',
              DefaultCheckInTime: '10:00',
              DefaultCheckOutTime: '18:00',
              ScheduleDayOfWeek: 1,
              IsWorkingDay: true,
              ScheduleStartTime: '10:00',
              ScheduleEndTime: '18:00',
            },
          ],
        };
      }
      if (
        /SELECT[\s\S]*ID[\s\S]*BranchID[\s\S]*EmpID[\s\S]*WorkDate[\s\S]*FROM dbo\.TblEmpAttendance WHERE ID = @id/i.test(
          sql,
        ) ||
        /SELECT ID,\s*BranchID,\s*WorkDate FROM dbo\.TblEmpAttendance WHERE ID = @id/i.test(
          sql,
        )
      ) {
        const id = Number(inputs.id);
        const row = store.rows.find((r) => r.ID === id);
        if (!row) return { recordset: [] };
        return {
          recordset: [
            {
              ID: row.ID,
              BranchID: row.BranchID,
              EmpID: row.EmpID,
              WorkDate: row.WorkDate,
              CheckInTime: row.CheckInTime,
              CheckOutTime: row.CheckOutTime,
            },
          ],
        };
      }
      if (
        /FROM dbo\.TblEmpAttendance/i.test(sql) &&
        /WorkDate = @workDate/i.test(sql) &&
        /BranchID = @branchId/i.test(sql) &&
        /SELECT/i.test(sql) &&
        !/INSERT/i.test(sql) &&
        !/UPDATE/i.test(sql)
      ) {
        const empId = Number(inputs.empId);
        const branchId = Number(inputs.branchId);
        const workDate = ymd(inputs.workDate);
        const row = store.rows.find(
          (r) => r.EmpID === empId && r.BranchID === branchId && r.WorkDate === workDate,
        );
        if (!row) return { recordset: [] };
        return {
          recordset: [
            {
              ID: row.ID,
              CheckInTime: row.CheckInTime,
              CheckOutTime: row.CheckOutTime,
            },
          ],
        };
      }
      if (/MERGE dbo\.TblEmpAttendance/i.test(sql)) {
        const BranchID = Number(inputs.branchId);
        const EmpID = Number(inputs.empId);
        const WorkDate = ymd(inputs.workDate);
        const incomingIn = hhmm(inputs.checkInTime);
        const incomingOut = hhmm(inputs.checkOutTime);
        const incomingStatus =
          inputs.status == null ? null : String(inputs.status);
        const incomingNotes =
          inputs.notes == null ? null : String(inputs.notes);
        const existing = store.rows.find(
          (r) =>
            r.BranchID === BranchID &&
            r.EmpID === EmpID &&
            r.WorkDate === WorkDate,
        );
        if (existing) {
          existing.CheckInTime = incomingIn ?? existing.CheckInTime;
          existing.CheckOutTime = incomingOut ?? existing.CheckOutTime;
          existing.Status = incomingStatus ?? existing.Status;
          existing.Notes = incomingNotes ?? existing.Notes;
          existing.UpdatedAt = new Date();
          return { recordset: [{ ...existing }] };
        }
        const row: Row = {
          ID: store.nextId++,
          BranchID,
          EmpID,
          WorkDate,
          CheckInTime: incomingIn,
          CheckOutTime: incomingOut,
          Status: incomingStatus,
          Notes: incomingNotes,
          CreatedAt: new Date(),
          UpdatedAt: null,
        };
        store.rows.push(row);
        return { recordset: [{ ...row }] };
      }
      if (
        /UPDATE dbo\.TblEmpAttendance/i.test(sql) &&
        /OUTPUT INSERTED\.ID, INSERTED\.BranchID/i.test(sql)
      ) {
        const id = Number(inputs.id);
        const branchId = Number(inputs.branchId);
        const row = store.rows.find((r) => r.ID === id && r.BranchID === branchId);
        if (!row) return { recordset: [] };
        if (Object.prototype.hasOwnProperty.call(inputs, 'checkInTime')) {
          row.CheckInTime = hhmm(inputs.checkInTime);
        }
        if (Object.prototype.hasOwnProperty.call(inputs, 'checkOutTime')) {
          row.CheckOutTime = hhmm(inputs.checkOutTime);
        }
        if (Object.prototype.hasOwnProperty.call(inputs, 'status')) {
          row.Status = inputs.status == null ? null : String(inputs.status);
        }
        if (Object.prototype.hasOwnProperty.call(inputs, 'notes')) {
          row.Notes = inputs.notes == null ? null : String(inputs.notes);
        }
        row.UpdatedAt = new Date();
        return { recordset: [{ ...row }] };
      }
      if (
        /UPDATE dbo\.TblEmpAttendance/i.test(sql) &&
        /WHERE ID = @id AND BranchID = @branchId/i.test(sql) &&
        !/IF EXISTS/i.test(sql)
      ) {
        const id = Number(inputs.id);
        const branchId = Number(inputs.branchId);
        const row = store.rows.find((r) => r.ID === id && r.BranchID === branchId);
        if (row) {
          row.CheckInTime = hhmm(inputs.checkInTime);
          row.CheckOutTime = hhmm(inputs.checkOutTime);
          row.Status = String(inputs.status);
        }
        return { recordset: [], rowsAffected: [row ? 1 : 0] };
      }
      if (
        /UPDATE dbo\.TblEmpAttendance/i.test(sql) &&
        /Status = NULL/i.test(sql) &&
        /Notes LIKE @sourceTag/i.test(sql)
      ) {
        const empId = Number(inputs.empId);
        const workDate = ymd(inputs.workDate);
        const sourceTag = String(inputs.sourceTag);
        let n = 0;
        for (const r of store.rows) {
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
      if (
        /IF EXISTS/i.test(sql) &&
        /TblEmpAttendance/i.test(sql) &&
        /Status = 'Absent'/i.test(sql) &&
        /CheckInTime = NULL/i.test(sql)
      ) {
        const empId = Number(inputs.empId);
        const branchId = Number(inputs.branchId);
        const workDate = ymd(inputs.workDate);
        const notes = inputs.notes == null ? null : String(inputs.notes);
        const existing = store.rows.find(
          (r) =>
            r.EmpID === empId &&
            r.BranchID === branchId &&
            r.WorkDate === workDate,
        );
        if (existing) {
          existing.Status = 'Absent';
          existing.Notes = notes;
          existing.CheckInTime = null;
          existing.CheckOutTime = null;
        } else {
          store.rows.push({
            ID: store.nextId++,
            BranchID: branchId,
            EmpID: empId,
            WorkDate: workDate,
            CheckInTime: null,
            CheckOutTime: null,
            Status: 'Absent',
            Notes: notes,
            CreatedAt: new Date(),
            UpdatedAt: null,
          });
        }
        return { recordset: [], rowsAffected: [1] };
      }
      if (/IF EXISTS/i.test(sql) && /TblEmpAttendance/i.test(sql)) {
        const empId = Number(inputs.empId);
        const branchId = Number(inputs.branchId);
        const workDate = ymd(inputs.workDate);
        const checkIn = hhmm(inputs.checkIn);
        const status = String(inputs.status);
        const notes = inputs.notes == null ? null : String(inputs.notes);
        const dayOffTag = String(inputs.dayOffTag ?? '');
        const existing = store.rows.find(
          (r) =>
            r.EmpID === empId &&
            r.BranchID === branchId &&
            r.WorkDate === workDate,
        );
        if (existing) {
          const prev = existing.Status;
          existing.Status = status;
          if (existing.CheckInTime == null || prev === 'Absent') {
            existing.CheckInTime = checkIn;
          }
          if (prev === 'Absent') existing.CheckOutTime = null;
          existing.Notes = notes;
        } else {
          store.rows.push({
            ID: store.nextId++,
            BranchID: branchId,
            EmpID: empId,
            WorkDate: workDate,
            CheckInTime: checkIn,
            CheckOutTime: null,
            Status: status,
            Notes: notes,
            CreatedAt: new Date(),
            UpdatedAt: null,
          });
        }
        if (dayOffTag) {
          for (const r of store.rows) {
            if (
              r.EmpID === empId &&
              r.WorkDate === workDate &&
              r.BranchID !== branchId &&
              r.Status === 'Absent' &&
              (r.Notes ?? '').startsWith(dayOffTag)
            ) {
              r.Status = status;
              if (r.CheckInTime == null) r.CheckInTime = checkIn;
              r.Notes = notes;
            }
          }
        }
        return { recordset: [], rowsAffected: [1] };
      }
      if (/INSERT INTO dbo\.TblEmpAttendance/i.test(sql)) {
        const row: Row = {
          ID: store.nextId++,
          BranchID: Number(inputs.branchId),
          EmpID: Number(inputs.empId),
          WorkDate: ymd(inputs.workDate),
          CheckInTime: hhmm(inputs.checkInTime),
          CheckOutTime: hhmm(inputs.checkOutTime),
          Status: String(inputs.status),
          Notes: null,
          CreatedAt: new Date(),
          UpdatedAt: null,
        };
        store.rows.push(row);
        return { recordset: [{ ID: row.ID }], rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [1] };
    },
  };
}

vi.mock('@/lib/db', () => {
  class MockRequest {
    private inner = makeRequest();
    input(name: string, type: unknown, value: unknown) {
      this.inner.input(name, type, value);
      return this;
    }
    query(sqlText: string) {
      return this.inner.query(sqlText);
    }
  }
  class MockTransaction {
    async begin() {
      txSnapshot = store.rows.map((r) => ({ ...r }));
    }
    async commit() {
      txSnapshot = null;
    }
    async rollback() {
      if (txSnapshot) {
        store.rows.length = 0;
        store.rows.push(...txSnapshot.map((r) => ({ ...r })));
      }
      txSnapshot = null;
    }
  }
  return {
    getPool: vi.fn(async () => ({ request: () => makeRequest() })),
    sql: {
      Int: 'Int',
      Date: 'Date',
      Time: 'Time',
      VarChar: (n: number) => `VarChar(${n})`,
      NVarChar: (n: number) => `NVarChar(${n})`,
      TinyInt: 'TinyInt',
      Request: MockRequest,
      Transaction: MockTransaction,
    },
  };
});

describe('resolveAdminPutAttendanceStatus', () => {
  it('recomputes Present from on-time check-in (client Late ignored)', () => {
    expect(
      resolveAdminPutAttendanceStatus({
        clientStatus: 'Late',
        checkInTime: '10:00',
        checkOutTime: null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
      }),
    ).toBe('Present');
  });

  it('recomputes Late from late check-in (client Present ignored)', () => {
    expect(
      resolveAdminPutAttendanceStatus({
        clientStatus: 'Present',
        checkInTime: '10:20',
        checkOutTime: null,
        lateMinutes: 20,
        earlyLeaveMinutes: 0,
      }),
    ).toBe('Late');
  });

  it('applies EarlyLeave only when computed status is Present', () => {
    expect(
      resolveAdminPutAttendanceStatus({
        clientStatus: 'Present',
        checkInTime: '10:00',
        checkOutTime: '17:00',
        lateMinutes: 0,
        earlyLeaveMinutes: 60,
      }),
    ).toBe('EarlyLeave');
    expect(
      resolveAdminPutAttendanceStatus({
        clientStatus: 'EarlyLeave',
        checkInTime: '10:20',
        checkOutTime: '17:00',
        lateMinutes: 20,
        earlyLeaveMinutes: 60,
      }),
    ).toBe('Late');
  });

  it('trusts Absent / DayOff / Excused', () => {
    expect(
      resolveAdminPutAttendanceStatus({
        clientStatus: 'Absent',
        checkInTime: '10:20',
        checkOutTime: null,
        lateMinutes: 20,
        earlyLeaveMinutes: 0,
      }),
    ).toBe('Absent');
    expect(
      resolveAdminPutAttendanceStatus({
        clientStatus: 'DayOff',
        checkInTime: undefined,
        checkOutTime: undefined,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
      }),
    ).toBe('DayOff');
    expect(
      resolveAdminPutAttendanceStatus({
        clientStatus: 'Excused',
        checkInTime: undefined,
        checkOutTime: undefined,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
      }),
    ).toBe('Excused');
  });
});

describe('saveAdminAttendance', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
    store.existingEmpIds = new Set([42]);
    store.empDefaults = defaultEmpMap();
    txSnapshot = null;
    assertEmpBranchWorkDayMutable.mockResolvedValue(undefined);
    assertEmployeeEligibleForBranchAttendance.mockResolvedValue(undefined);
  });

  it('rejects same-WorkDate other-branch OPEN with ALREADY_OPEN; stale historical does not block', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-01-01',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'Present',
    });
    const { saveAdminAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendance({
      branchId: 10,
      userId: 1,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
    });
    expect(store.rows.filter((r) => r.BranchID === 10)).toHaveLength(1);

    store.rows.length = 0;
    store.nextId = 1;
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '08:00',
      CheckOutTime: null,
      Status: 'Present',
    });
    await expect(
      saveAdminAttendance({
        branchId: 10,
        userId: 1,
        empId: 42,
        workDate: '2026-08-24',
        checkInTime: '10:00',
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 409,
      code: 'ALREADY_OPEN',
    });
    expect(store.rows.filter((r) => r.BranchID === 10)).toHaveLength(0);
  });

  it('upserts the same (BranchID, EmpID, WorkDate) row', async () => {
    const { saveAdminAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendance({
      branchId: 10,
      userId: 1,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
    });
    await saveAdminAttendance({
      branchId: 10,
      userId: 1,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
      checkOutTime: '18:00',
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      BranchID: 10,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '10:00',
      CheckOutTime: '18:00',
    });
  });

  it('syncs payroll hours only when both punches exist', async () => {
    const { saveAdminAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendance({
      branchId: 10,
      userId: 1,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
    });
    expect(syncNonPostedPayrollHoursFromAttendance).not.toHaveBeenCalled();
    await saveAdminAttendance({
      branchId: 10,
      userId: 1,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
      checkOutTime: '18:00',
    });
    expect(syncNonPostedPayrollHoursFromAttendance).toHaveBeenCalledTimes(1);
    expect(syncNonPostedPayrollHoursFromAttendance).toHaveBeenCalledWith({
      empId: 42,
      workDate: '2026-08-24',
      branchId: 10,
    });
  });

  it('propagates closed payroll-day gate before mutation', async () => {
    assertEmpBranchWorkDayMutable.mockRejectedValueOnce(
      new EmpBranchWorkDayCloseError(PAYROLL_DAY_CLOSED_CODE, PAYROLL_DAY_CLOSED_MESSAGE),
    );
    const { saveAdminAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      saveAdminAttendance({
        branchId: 10,
        userId: 1,
        empId: 42,
        workDate: '2026-08-24',
        checkInTime: '10:00',
      }),
    ).rejects.toBeInstanceOf(EmpBranchWorkDayCloseError);
    expect(store.rows).toHaveLength(0);
    expect(syncAttendanceShiftToOverrides).not.toHaveBeenCalled();
  });
});

describe('saveLegacyEmployeeAttendance', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
    store.existingEmpIds = new Set([42]);
    store.empDefaults = defaultEmpMap();
    txSnapshot = null;
    assertEmpBranchWorkDayMutable.mockResolvedValue(undefined);
    assertEmployeeEligibleForBranchAttendance.mockResolvedValue(undefined);
  });

  it('MERGE ISNULL keeps CheckInTime on checkout-only update', async () => {
    store.rows.push({
      ID: 7,
      BranchID: 10,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '10:00',
      CheckOutTime: null,
      Status: 'present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { saveLegacyEmployeeAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await saveLegacyEmployeeAttendance({
      branchId: 10,
      empId: 42,
      workDate: '2026-08-24',
      checkOutTime: '18:00',
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].CheckInTime).toBe('10:00');
    expect(store.rows[0].CheckOutTime).toBe('18:00');
    expect(result.isNew).toBe(false);
    expect(result.row.CheckInTime).toBe('10:00');
  });

  it('trusts lowercase client status (no Present/Late recompute)', async () => {
    const { saveLegacyEmployeeAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await saveLegacyEmployeeAttendance({
      branchId: 10,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:20',
      status: 'present',
    });
    expect(result.row.Status).toBe('present');
    expect(store.rows[0].Status).toBe('present');
  });

  it('returns isNew true on insert and false on MERGE update', async () => {
    const { saveLegacyEmployeeAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const created = await saveLegacyEmployeeAttendance({
      branchId: 10,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
      status: 'present',
    });
    expect(created.isNew).toBe(true);
    expect(created.row.UpdatedAt).toBeNull();
    const updated = await saveLegacyEmployeeAttendance({
      branchId: 10,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:05',
      status: 'late',
    });
    expect(updated.isNew).toBe(false);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].CheckInTime).toBe('10:05');
  });

  it('runs OPEN check only when checkInTime is set and checkOutTime is absent', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { saveLegacyEmployeeAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      saveLegacyEmployeeAttendance({
        branchId: 10,
        empId: 42,
        workDate: '2026-08-24',
        checkInTime: '10:00',
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 409,
      code: 'ALREADY_OPEN',
    });

    const checkoutOnly = await saveLegacyEmployeeAttendance({
      branchId: 10,
      empId: 42,
      workDate: '2026-08-24',
      checkOutTime: '18:00',
    });
    expect(checkoutOnly.isNew).toBe(true);
    expect(checkoutOnly.row.CheckOutTime).toBe('18:00');
    expect(store.rows.filter((r) => r.BranchID === 10)).toHaveLength(1);
  });

  it('stale OPEN on old WorkDate does not block legacy POST check-in', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-01-01',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { saveLegacyEmployeeAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await saveLegacyEmployeeAttendance({
      branchId: 10,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
    });
    expect(result.isNew).toBe(true);
    expect(store.rows.filter((r) => r.CheckInTime && r.CheckOutTime == null)).toHaveLength(
      2,
    );
  });

  it('notifies availability after MERGE and skips admin-only side effects', async () => {
    const { saveLegacyEmployeeAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveLegacyEmployeeAttendance({
      branchId: 10,
      empId: 42,
      workDate: '2026-08-24',
      checkInTime: '10:00',
      checkOutTime: '18:00',
      status: 'present',
    });
    expect(availabilityEmployeeDayChanged).toHaveBeenCalledTimes(1);
    expect(availabilityEmployeeDayChanged).toHaveBeenCalledWith({
      employeeId: 42,
      businessDate: '2026-08-24',
      branchId: 10,
      reason: 'employees_attendance_upsert',
    });
    expect(replaceAttendanceBreaks).not.toHaveBeenCalled();
    expect(replaceAttendanceBreakTimes).not.toHaveBeenCalled();
    expect(syncBlockRangesFromBreaks).not.toHaveBeenCalled();
    expect(syncAttendanceShiftToOverrides).not.toHaveBeenCalled();
    expect(syncAttendanceAbsenceToDayOffOverride).not.toHaveBeenCalled();
    expect(scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
    expect(syncNonPostedPayrollHoursFromAttendance).not.toHaveBeenCalled();
    expect(unlockScheduleForWorkOnDayOff).not.toHaveBeenCalled();
  });
});

describe('updateLegacyEmployeeAttendanceById', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
    store.existingEmpIds = new Set([42]);
    store.empDefaults = defaultEmpMap();
    txSnapshot = null;
    assertEmpBranchWorkDayMutable.mockResolvedValue(undefined);
    assertEmployeeEligibleForBranchAttendance.mockResolvedValue(undefined);
  });

  function seedOwned(overrides: Partial<Row> = {}): Row {
    const row: Row = {
      ID: 7,
      BranchID: 10,
      EmpID: 42,
      WorkDate: '2026-08-01',
      CheckInTime: '10:00',
      CheckOutTime: '18:00',
      Status: 'present',
      Notes: 'keep-me',
      CreatedAt: new Date(),
      UpdatedAt: null,
      ...overrides,
    };
    store.rows.push(row);
    return row;
  }

  it('treats a cross-branch row as not found and does not update', async () => {
    seedOwned({ BranchID: 20, Notes: 'foreign' });
    const { updateLegacyEmployeeAttendanceById } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      updateLegacyEmployeeAttendanceById({
        branchId: 10,
        attendanceId: 7,
        notes: 'hijack',
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 404,
      message: 'غير موجود',
    });
    expect(store.rows[0].Notes).toBe('foreign');
    expect(assertEmpBranchWorkDayMutable).not.toHaveBeenCalled();
    expect(availabilityEmployeeDayChanged).not.toHaveBeenCalled();
  });

  it('uses existing row WorkDate for the payroll-day gate', async () => {
    seedOwned({ WorkDate: '2026-08-01' });
    const { updateLegacyEmployeeAttendanceById } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await updateLegacyEmployeeAttendanceById({
      branchId: 10,
      attendanceId: 7,
      notes: 'x',
    });
    expect(assertEmpBranchWorkDayMutable).toHaveBeenCalledWith(10, '2026-08-01');
  });

  it('null clears a field; undefined leaves it; empty string persists', async () => {
    seedOwned();
    const { updateLegacyEmployeeAttendanceById } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const cleared = await updateLegacyEmployeeAttendanceById({
      branchId: 10,
      attendanceId: 7,
      checkOutTime: null,
    });
    expect(cleared.row.CheckOutTime).toBeNull();
    expect(store.rows[0].CheckInTime).toBe('10:00');

    const kept = await updateLegacyEmployeeAttendanceById({
      branchId: 10,
      attendanceId: 7,
      notes: 'only-notes',
    });
    expect(kept.row.CheckInTime).toBe('10:00');
    expect(kept.row.CheckOutTime).toBeNull();
    expect(kept.row.Notes).toBe('only-notes');

    const emptied = await updateLegacyEmployeeAttendanceById({
      branchId: 10,
      attendanceId: 7,
      notes: '',
    });
    expect(emptied.row.Notes).toBe('');
  });

  it('rejects same-WorkDate other-branch OPEN when becoming OPEN; stale still allows', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-01-01',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    seedOwned({ ID: 7, WorkDate: '2026-08-24' });
    const { updateLegacyEmployeeAttendanceById } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const staleOk = await updateLegacyEmployeeAttendanceById({
      branchId: 10,
      attendanceId: 7,
      checkOutTime: null,
    });
    expect(staleOk.row.CheckOutTime).toBeNull();

    store.rows.length = 0;
    store.nextId = 1;
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    seedOwned({ ID: 7, WorkDate: '2026-08-24' });
    await expect(
      updateLegacyEmployeeAttendanceById({
        branchId: 10,
        attendanceId: 7,
        checkOutTime: null,
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 409,
      code: 'ALREADY_OPEN',
    });
  });

  it('trusts lowercase status as sent', async () => {
    seedOwned({ WorkDate: '2026-08-24' });
    const { updateLegacyEmployeeAttendanceById } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await updateLegacyEmployeeAttendanceById({
      branchId: 10,
      attendanceId: 7,
      status: 'late',
    });
    expect(result.row.Status).toBe('late');
  });

  it('notifies after success and not on payroll-day failure', async () => {
    seedOwned({ WorkDate: '2026-08-24' });
    assertEmpBranchWorkDayMutable.mockRejectedValueOnce(
      new EmpBranchWorkDayCloseError(PAYROLL_DAY_CLOSED_CODE, PAYROLL_DAY_CLOSED_MESSAGE),
    );
    const { updateLegacyEmployeeAttendanceById } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      updateLegacyEmployeeAttendanceById({
        branchId: 10,
        attendanceId: 7,
        notes: 'x',
      }),
    ).rejects.toBeInstanceOf(EmpBranchWorkDayCloseError);
    expect(store.rows[0].Notes).toBe('keep-me');
    expect(availabilityEmployeeDayChanged).not.toHaveBeenCalled();

    assertEmpBranchWorkDayMutable.mockResolvedValue(undefined);
    await updateLegacyEmployeeAttendanceById({
      branchId: 10,
      attendanceId: 7,
      notes: 'ok',
    });
    expect(availabilityEmployeeDayChanged).toHaveBeenCalledTimes(1);
    expect(availabilityEmployeeDayChanged).toHaveBeenCalledWith({
      employeeId: 42,
      businessDate: '2026-08-24',
      branchId: 10,
      reason: 'employees_attendance_update',
    });
    expect(assertEmployeeEligibleForBranchAttendance).not.toHaveBeenCalled();
    expect(scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
    expect(syncNonPostedPayrollHoursFromAttendance).not.toHaveBeenCalled();
  });
});

class BulkEligError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

describe('saveAdminAttendanceBulk', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
    store.existingEmpIds = new Set([42, 43]);
    store.empDefaults = defaultEmpMap();
    txSnapshot = null;
    assertEmpBranchWorkDayMutable.mockResolvedValue(undefined);
    assertEmployeeEligibleForBranchAttendance.mockResolvedValue(undefined);
    getEffectiveBranchScheduleRow.mockResolvedValue({ isWorking: true });
    unlockScheduleForWorkOnDayOff.mockResolvedValue({});
    syncAttendanceShiftToOverrides.mockResolvedValue({ deactivated: 0, inserted: 0 });
    syncAttendanceAbsenceToDayOffOverride.mockResolvedValue({
      cleared: 0,
      ensured: false,
    });
  });

  it('commits all rows together', async () => {
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const summary = await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [
        { EmpID: 42, CheckInTime: '10:00' },
        { EmpID: 43, CheckInTime: '10:00' },
      ],
    });
    expect(summary).toEqual({
      savedCount: 2,
      insertedCount: 2,
      updatedCount: 0,
    });
    expect(store.rows).toHaveLength(2);
    expect(assertEmpBranchWorkDayMutable).toHaveBeenCalledTimes(1);
    expect(assertEmpBranchWorkDayMutable).toHaveBeenCalledWith(10, '2026-08-24');
  });

  it('rolls all attendance rows back on eligibility failure', async () => {
    assertEmployeeEligibleForBranchAttendance
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new BulkEligError('غير مسموح', 403));
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      saveAdminAttendanceBulk({
        branchId: 10,
        userId: 1,
        workDate: '2026-08-24',
        items: [
          { EmpID: 42, CheckInTime: '10:00' },
          { EmpID: 43, CheckInTime: '10:00' },
        ],
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 403,
      message: 'غير مسموح (موظف 43 — Emp B)',
    });
    expect(store.rows).toHaveLength(0);
    expect(scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
  });

  it('rolls all attendance rows back on override failure', async () => {
    syncAttendanceShiftToOverrides
      .mockResolvedValueOnce({ deactivated: 0, inserted: 0 })
      .mockRejectedValueOnce(new Error('override boom'));
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      saveAdminAttendanceBulk({
        branchId: 10,
        userId: 1,
        workDate: '2026-08-24',
        items: [
          { EmpID: 42, CheckInTime: '10:00' },
          { EmpID: 43, CheckInTime: '10:00' },
        ],
      }),
    ).rejects.toThrow('override boom');
    expect(store.rows).toHaveLength(0);
    expect(scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
  });

  it('rejects same-WorkDate other-branch OPEN; stale historical still allows', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-01-01',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [{ EmpID: 42, CheckInTime: '10:00' }],
    });
    expect(
      store.rows.filter((r) => r.CheckInTime != null && r.CheckOutTime == null),
    ).toHaveLength(2);

    store.rows.length = 0;
    store.nextId = 1;
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    await expect(
      saveAdminAttendanceBulk({
        branchId: 10,
        userId: 1,
        workDate: '2026-08-24',
        items: [{ EmpID: 42, CheckInTime: '10:00' }],
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 409,
      code: 'ALREADY_OPEN',
    });
    expect(store.rows.filter((r) => r.BranchID === 10)).toHaveLength(0);
  });

  it('applies request WorkDate to all items and ignores item WorkDate', async () => {
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [
        { EmpID: 42, CheckInTime: '10:00', WorkDate: '1999-01-01' },
        { EmpID: 43, CheckInTime: '10:00', WorkDate: '2000-01-01' },
      ],
    });
    expect(store.rows.map((r) => r.WorkDate)).toEqual(['2026-08-24', '2026-08-24']);
  });

  it('applies session BranchID to all items and ignores item BranchID', async () => {
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [
        { EmpID: 42, CheckInTime: '10:00', BranchID: 99 },
        { EmpID: 43, CheckInTime: '10:00', BranchID: 77 },
      ],
    });
    expect(store.rows.every((r) => r.BranchID === 10)).toBe(true);
  });

  it('calculates Late from TblEmp DefaultCheckInTime, not branch work-schedule JOIN', async () => {
    store.empDefaults.set(42, {
      EmpID: 42,
      EmpName: 'Test Emp',
      DefaultCheckInTime: '09:00',
      DefaultCheckOutTime: '18:00',
    });
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [{ EmpID: 42, CheckInTime: '10:00', Status: 'Pending' }],
    });
    expect(store.rows[0].Status).toBe('Late');
  });

  it('omitted punch overwrites existing to null', async () => {
    store.rows.push({
      ID: 7,
      BranchID: 10,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '10:00',
      CheckOutTime: '18:00',
      Status: 'Present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [{ EmpID: 42, CheckInTime: '10:00' }],
    });
    expect(store.rows[0].CheckInTime).toBe('10:00');
    expect(store.rows[0].CheckOutTime).toBeNull();
  });

  it('omitted Breaks on a punched row retain existing (do not replace)', async () => {
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [{ EmpID: 42, CheckInTime: '10:00', CheckOutTime: '18:00' }],
    });
    expect(replaceAttendanceBreaks).not.toHaveBeenCalled();
    expect(replaceAttendanceBreakTimes).not.toHaveBeenCalled();
  });

  it('schedules WhatsApp only after successful commit', async () => {
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [{ EmpID: 42, CheckInTime: '10:00' }],
    });
    expect(scheduleAttendanceCheckInOutWhatsApp).toHaveBeenCalledTimes(1);
    expect(scheduleAttendanceCheckInOutWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({
        empId: 42,
        checkInTime: '10:00',
        checkOutTime: null,
      }),
    );
  });

  it('does not schedule WhatsApp after rollback', async () => {
    syncAttendanceAbsenceToDayOffOverride.mockRejectedValueOnce(
      new Error('absence sync failed'),
    );
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      saveAdminAttendanceBulk({
        branchId: 10,
        userId: 1,
        workDate: '2026-08-24',
        items: [{ EmpID: 42, CheckInTime: '10:00' }],
      }),
    ).rejects.toThrow('absence sync failed');
    expect(store.rows).toHaveLength(0);
    expect(scheduleAttendanceCheckInOutWhatsApp).not.toHaveBeenCalled();
  });

  it('does not sync payroll hours or availability', async () => {
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [
        {
          EmpID: 42,
          CheckInTime: '10:00',
          CheckOutTime: '18:00',
        },
      ],
    });
    expect(syncNonPostedPayrollHoursFromAttendance).not.toHaveBeenCalled();
    expect(availabilityEmployeeDayChanged).not.toHaveBeenCalled();
  });

  it('day-off unlock stays external/best-effort and can outlive rollback', async () => {
    getEffectiveBranchScheduleRow.mockResolvedValue({ isWorking: false });
    assertEmployeeEligibleForBranchAttendance
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new BulkEligError('blocked', 403));
    const { saveAdminAttendanceBulk } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      saveAdminAttendanceBulk({
        branchId: 10,
        userId: 1,
        workDate: '2026-08-24',
        items: [
          { EmpID: 42, CheckInTime: '10:00' },
          { EmpID: 43, CheckInTime: '10:00' },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(unlockScheduleForWorkOnDayOff).toHaveBeenCalledTimes(1);
    expect(unlockScheduleForWorkOnDayOff).toHaveBeenCalledWith({
      empId: 42,
      date: '2026-08-24',
      branchId: 10,
      reason: 'نزل يشتغل يوم إجازته — تسجيل حضور',
      sourceTag: 'work-on-day-off',
    });
    expect(store.rows).toHaveLength(0);

    unlockScheduleForWorkOnDayOff.mockRejectedValueOnce(new Error('unlock failed'));
    assertEmployeeEligibleForBranchAttendance.mockResolvedValue(undefined);
    getEffectiveBranchScheduleRow.mockResolvedValue({ isWorking: false });
    const summary = await saveAdminAttendanceBulk({
      branchId: 10,
      userId: 1,
      workDate: '2026-08-24',
      items: [{ EmpID: 42, CheckInTime: '10:00' }],
    });
    expect(summary.savedCount).toBe(1);
  });
});

describe('workOnDayOff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
    store.empDefaults = defaultEmpMap();
    txSnapshot = null;
    getCairoTimeStr.mockReturnValue('11:30');
    unlockScheduleForWorkOnDayOff.mockResolvedValue({
      dayOffOverridesCleared: 1,
      dayOffRowsCleared: 0,
      customHours: { start: '10:00', end: '22:00' },
    });
  });

  it('unlocks schedule and persists Present check-in via repo upsert', async () => {
    const { workOnDayOff } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await workOnDayOff({
      empId: 42,
      date: '2026-08-24',
      branchId: 10,
      reason: 'نزل يشتغل',
      sourceTag: 'work-on-day-off',
    });
    expect(executeWorkOnDayOff).not.toHaveBeenCalled();
    expect(unlockScheduleForWorkOnDayOff).toHaveBeenCalledWith({
      empId: 42,
      date: '2026-08-24',
      branchId: 10,
      reason: 'نزل يشتغل',
      sourceTag: 'work-on-day-off',
    });
    expect(result).toMatchObject({
      ok: true,
      checkInTime: '11:30',
      branchId: 10,
    });
    expect(store.rows[0]).toMatchObject({
      Status: 'Present',
      CheckInTime: '11:30',
      CheckOutTime: null,
      BranchID: 10,
    });
  });

  it('rejects same-WorkDate other-branch OPEN with ALREADY_OPEN', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { workOnDayOff } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      workOnDayOff({
        empId: 42,
        date: '2026-08-24',
        branchId: 10,
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 409,
      code: 'ALREADY_OPEN',
    });
    expect(store.rows.filter((r) => r.BranchID === 10)).toHaveLength(0);
  });
});

describe('restorePresent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
    store.empDefaults = defaultEmpMap();
    unlockScheduleForWorkOnDayOff.mockResolvedValue({
      dayOffOverridesCleared: 1,
      dayOffRowsCleared: 0,
      customHours: { start: '10:00', end: '22:00' },
    });
    getBranchById.mockResolvedValue({
      branchId: 10,
      isActive: true,
      defaultOpenTime: '10:00',
      defaultCloseTime: '22:00',
    });
    getBarberDayStatus.mockResolvedValue({
      isWorkingDay: true,
      isDayOff: false,
      isAbsent: false,
      statusReasonArabic: 'متاح',
      currentAvailabilityStatus: 'working',
      effectiveStart: '10:00',
      effectiveEnd: '22:00',
      attendance: { status: 'Present' },
    });
    getCairoTimeStr.mockReturnValue('12:15');
  });

  it('future date: unlock only — no attendance', async () => {
    const { restorePresent } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await restorePresent({
      empId: 42,
      date: '2026-08-30',
      branchId: 10,
      todayBusiness: '2026-08-24',
      todayCalendar: '2026-08-24',
    });
    expect(result.attendanceRecorded).toBe(false);
    expect(result.checkInTime).toBeNull();
    expect(store.rows).toHaveLength(0);
    expect(unlockScheduleForWorkOnDayOff).toHaveBeenCalled();
  });

  it('today: upserts Present and patches tagged other-branch Absent', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: null,
      CheckOutTime: null,
      Status: 'Absent',
      Notes: 'schedule-control day_off: weekly',
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { restorePresent } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await restorePresent({
      empId: 42,
      date: '2026-08-24',
      branchId: 10,
      reason: 'رجع',
      todayBusiness: '2026-08-24',
      todayCalendar: '2026-08-24',
    });
    expect(result.attendanceRecorded).toBe(true);
    expect(result.checkInTime).toBe('12:15');
    expect(store.rows.find((r) => r.BranchID === 10)).toMatchObject({
      Status: 'Present',
      CheckInTime: '12:15',
    });
    expect(store.rows.find((r) => r.BranchID === 20)).toMatchObject({
      Status: 'Present',
      CheckInTime: '12:15',
    });
  });

  it('rejects same-WorkDate other-branch OPEN on today punch', async () => {
    store.rows.push({
      ID: 1,
      BranchID: 20,
      EmpID: 42,
      WorkDate: '2026-08-24',
      CheckInTime: '09:00',
      CheckOutTime: null,
      Status: 'Present',
      Notes: null,
      CreatedAt: new Date(),
      UpdatedAt: null,
    });
    const { restorePresent } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      restorePresent({
        empId: 42,
        date: '2026-08-24',
        branchId: 10,
        todayBusiness: '2026-08-24',
        todayCalendar: '2026-08-24',
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 409,
      code: 'ALREADY_OPEN',
    });
    expect(store.rows.filter((r) => r.BranchID === 10)).toHaveLength(0);
  });

  it('invalidates hot cache after success', async () => {
    const { restorePresent } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await restorePresent({
      empId: 42,
      date: '2026-08-24',
      branchId: 10,
      todayBusiness: '2026-08-24',
      todayCalendar: '2026-08-24',
    });
    await vi.waitFor(() => {
      expect(notifyHotEffectiveDay).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 42,
          businessDate: '2026-08-24',
          branchId: 10,
          reason: 'schedule_control_restore_present',
        }),
      );
    });
  });

  it('rejects past dates with AttendanceCommandError 400', async () => {
    const { restorePresent } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await expect(
      restorePresent({
        empId: 42,
        date: '2026-08-01',
        branchId: 10,
        todayBusiness: '2026-08-24',
        todayCalendar: '2026-08-24',
      }),
    ).rejects.toMatchObject({
      name: 'AttendanceCommandError',
      statusCode: 400,
    });
    expect(unlockScheduleForWorkOnDayOff).not.toHaveBeenCalled();
  });
});

describe('applyScheduleControlDayOffAttendance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
  });

  it('inserts Absent and clears punches on existing Present', async () => {
    const { applyScheduleControlDayOffAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    await applyScheduleControlDayOffAttendance({
      empId: 42,
      workDate: '2026-08-24',
      branchId: 10,
      reason: 'إجازة',
    });
    expect(store.rows[0]).toMatchObject({
      Status: 'Absent',
      Notes: 'schedule-control day_off: إجازة',
      CheckInTime: null,
      CheckOutTime: null,
      BranchID: 10,
    });

    store.rows[0].Status = 'Present';
    store.rows[0].CheckInTime = '10:00';
    store.rows[0].CheckOutTime = '18:00';
    await applyScheduleControlDayOffAttendance({
      empId: 42,
      workDate: '2026-08-24',
      branchId: 10,
    });
    expect(store.rows[0]).toMatchObject({
      Status: 'Absent',
      CheckInTime: null,
      CheckOutTime: null,
      Notes: 'schedule-control day_off',
    });
  });
});

describe('revertScheduleControlDayOffAttendance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.rows = [];
    store.nextId = 1;
  });

  it('reverts tagged Absent across branches; leaves untagged alone', async () => {
    store.rows.push(
      {
        ID: 1,
        BranchID: 10,
        EmpID: 42,
        WorkDate: '2026-08-24',
        CheckInTime: null,
        CheckOutTime: null,
        Status: 'Absent',
        Notes: 'schedule-control day_off: x',
        CreatedAt: new Date(),
        UpdatedAt: null,
      },
      {
        ID: 2,
        BranchID: 20,
        EmpID: 42,
        WorkDate: '2026-08-24',
        CheckInTime: null,
        CheckOutTime: null,
        Status: 'Absent',
        Notes: 'manual',
        CreatedAt: new Date(),
        UpdatedAt: null,
      },
    );
    const { revertScheduleControlDayOffAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await revertScheduleControlDayOffAttendance({
      empId: 42,
      workDate: '2026-08-24',
    });
    expect(result.attendanceReverted).toBe(true);
    expect(store.rows[0]).toMatchObject({ Status: null, Notes: null });
    expect(store.rows[1]).toMatchObject({ Status: 'Absent', Notes: 'manual' });
  });

  it('returns attendanceReverted false on SQL failure (best-effort)', async () => {
    const { getPool } = await import('@/lib/db');
    vi.mocked(getPool).mockRejectedValueOnce(new Error('db down'));
    const { revertScheduleControlDayOffAttendance } = await import(
      '@/modules/attendance/application/AttendanceCommandService'
    );
    const result = await revertScheduleControlDayOffAttendance({
      empId: 42,
      workDate: '2026-08-24',
    });
    expect(result).toEqual({ attendanceReverted: false });
  });
});
