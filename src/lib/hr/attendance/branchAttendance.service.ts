import 'server-only';
import { sql } from '@/lib/db';
import { listEmployeeActiveBranchAssignments } from '@/lib/branch/repository';
import { getOpenBusinessDay, getBranchBusinessDate } from '@/lib/branch/businessDay';
import type { ActiveBranchContext } from '@/lib/branch/types';

export class AttendanceDomainError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

type Tx = sql.Transaction;

export type AttendanceRow = {
  id: number;
  branchId: number;
  empId: number;
  workDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: string;
};

function mapRow(row: Record<string, unknown>): AttendanceRow {
  const asDate = (v: unknown) => {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  const asTime = (v: unknown) => {
    if (v == null) return null;
    const s = String(v);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };
  return {
    id: Number(row.ID),
    branchId: Number(row.BranchID),
    empId: Number(row.EmpID),
    workDate: asDate(row.WorkDate),
    checkInTime: asTime(row.CheckInTime),
    checkOutTime: asTime(row.CheckOutTime),
    status: String(row.Status || 'Pending'),
  };
}

async function acquireEmployeeAttendanceLock(
  transaction: Tx,
  empId: number,
  lockTimeoutMs = 5000,
): Promise<void> {
  const lockResource = `attendance-session:${empId}`;
  const lockResult = await new sql.Request(transaction)
    .input('lockResource', sql.NVarChar(255), lockResource)
    .input('lockTimeout', sql.Int, lockTimeoutMs)
    .query(`
      DECLARE @LockResult INT;
      EXEC @LockResult = sp_getapplock
        @Resource = @lockResource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = @lockTimeout;
      SELECT @LockResult AS lockResult;
    `);
  const result = Number(lockResult.recordset[0].lockResult);
  if (result < 0) {
    throw new AttendanceDomainError(
      'ATTENDANCE_BUSY',
      'سجل الحضور مشغول — أعد المحاولة بعد لحظات',
      503,
    );
  }
}

export async function assertEmployeeEligibleForBranchAttendance(
  empId: number,
  branchId: number,
  workDate: string,
): Promise<void> {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();
  const empRow = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT EmpID, ISNULL(isActive, 1) AS isActive
      FROM dbo.TblEmp WHERE EmpID = @empId
    `);
  if (!empRow.recordset[0]) {
    throw new AttendanceDomainError('EMP_NOT_FOUND', 'الموظف غير موجود', 404);
  }
  if (!empRow.recordset[0].isActive) {
    throw new AttendanceDomainError('EMP_INACTIVE', 'الموظف غير نشط', 403);
  }

  const at = new Date(`${workDate}T12:00:00.000Z`);
  const assignments = await listEmployeeActiveBranchAssignments(empId, at);
  const ok = assignments.some((a) => a.branchId === branchId && a.isActive);
  if (!ok) {
    throw new AttendanceDomainError(
      'ASSIGNMENT_REQUIRED',
      'الموظف غير مُعيَّن لهذا الفرع في تاريخ العمل',
      403,
    );
  }
}

export async function resolveAttendanceWorkDate(
  branch: ActiveBranchContext,
): Promise<{ workDate: string; businessDayId: number | null }> {
  const open = await getOpenBusinessDay(branch.branchId);
  if (open) {
    return { workDate: open.newDay, businessDayId: open.id };
  }
  return {
    workDate: getBranchBusinessDate(branch),
    businessDayId: null,
  };
}

export async function getOpenAttendanceForEmployee(
  transaction: Tx,
  empId: number,
): Promise<AttendanceRow | null> {
  const result = await new sql.Request(transaction)
    .input('empId', sql.Int, empId)
    .query(`
      SELECT TOP 1
        ID, BranchID, EmpID, WorkDate, Status,
        CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(8), CheckOutTime, 108) AS CheckOutTime
      FROM dbo.TblEmpAttendance WITH (UPDLOCK, HOLDLOCK)
      WHERE EmpID = @empId
        AND CheckInTime IS NOT NULL
        AND CheckOutTime IS NULL
      ORDER BY WorkDate DESC, ID DESC
    `);
  if (!result.recordset[0]) return null;
  return mapRow(result.recordset[0]);
}

export async function getBranchAttendanceByEmpDate(
  transaction: Tx,
  branchId: number,
  empId: number,
  workDate: string,
): Promise<AttendanceRow | null> {
  const result = await new sql.Request(transaction)
    .input('branchId', sql.Int, branchId)
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1
        ID, BranchID, EmpID, WorkDate, Status,
        CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(8), CheckOutTime, 108) AS CheckOutTime
      FROM dbo.TblEmpAttendance WITH (UPDLOCK, HOLDLOCK)
      WHERE BranchID = @branchId AND EmpID = @empId AND WorkDate = @workDate
    `);
  if (!result.recordset[0]) return null;
  return mapRow(result.recordset[0]);
}

function timeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || !String(timeStr).trim()) return null;
  const parts = String(timeStr).split(':').map(Number);
  const d = new Date(0);
  d.setUTCHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);
  return d;
}

/**
 * Check-in at the session active branch. Rejects body BranchID at the route layer.
 * Idempotent: returns existing open session for this branch/date if already checked in.
 */
export async function checkInEmployee(
  transaction: Tx,
  args: {
    branch: ActiveBranchContext;
    empId: number;
    userId: number;
    checkInTime: string;
    status?: string;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    lateMinutes?: number;
    notes?: string | null;
    /** Optional override only when caller already derived WorkDate server-side */
    workDate?: string;
  },
): Promise<AttendanceRow> {
  if (!args.branch.canOperate) {
    throw new AttendanceDomainError('NO_OPERATE', 'غير مصرح بتشغيل هذا الفرع', 403);
  }

  const { workDate } =
    args.workDate != null
      ? { workDate: args.workDate }
      : await resolveAttendanceWorkDate(args.branch);

  await assertEmployeeEligibleForBranchAttendance(
    args.empId,
    args.branch.branchId,
    workDate,
  );

  await acquireEmployeeAttendanceLock(transaction, args.empId);

  const anyOpen = await getOpenAttendanceForEmployee(transaction, args.empId);
  if (anyOpen) {
    if (
      anyOpen.branchId === args.branch.branchId &&
      anyOpen.workDate === workDate
    ) {
      return anyOpen; // idempotent retry
    }
    throw new AttendanceDomainError(
      'ALREADY_OPEN',
      'الموظف لديه حضور مفتوح في فرع آخر أو يوم آخر — سجّل الانصراف أولاً',
      409,
    );
  }

  const existing = await getBranchAttendanceByEmpDate(
    transaction,
    args.branch.branchId,
    args.empId,
    workDate,
  );
  if (existing?.checkInTime && !existing.checkOutTime) {
    return existing;
  }
  if (existing?.checkInTime && existing.checkOutTime) {
    throw new AttendanceDomainError(
      'ALREADY_CLOSED',
      'يوجد سجل حضور مكتمل لهذا الفرع والتاريخ',
      409,
    );
  }

  const status = args.status || 'Present';
  if (existing) {
    await new sql.Request(transaction)
      .input('id', sql.Int, existing.id)
      .input('branchId', sql.Int, args.branch.branchId)
      .input('checkIn', sql.Time, timeToDate(args.checkInTime))
      .input('status', sql.NVarChar(50), status)
      .input('late', sql.Int, args.lateMinutes ?? 0)
      .input('schedStart', sql.Time, timeToDate(args.scheduledStart ?? null))
      .input('schedEnd', sql.Time, timeToDate(args.scheduledEnd ?? null))
      .input('notes', sql.NVarChar(500), args.notes ?? null)
      .input('userId', sql.Int, args.userId)
      .query(`
        UPDATE dbo.TblEmpAttendance
        SET CheckInTime = @checkIn,
            Status = @status,
            LateMinutes = @late,
            ScheduledStartTime = ISNULL(@schedStart, ScheduledStartTime),
            ScheduledEndTime = ISNULL(@schedEnd, ScheduledEndTime),
            Notes = COALESCE(@notes, Notes),
            UpdatedByUserID = @userId,
            UpdatedAt = GETDATE()
        WHERE ID = @id AND BranchID = @branchId
      `);
    const updated = await getBranchAttendanceByEmpDate(
      transaction,
      args.branch.branchId,
      args.empId,
      workDate,
    );
    if (!updated) throw new AttendanceDomainError('UPDATE_FAILED', 'فشل تحديث الحضور', 500);
    return updated;
  }

  const ins = await new sql.Request(transaction)
    .input('branchId', sql.Int, args.branch.branchId)
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, workDate)
    .input('checkIn', sql.Time, timeToDate(args.checkInTime))
    .input('status', sql.NVarChar(50), status)
    .input('late', sql.Int, args.lateMinutes ?? 0)
    .input('schedStart', sql.Time, timeToDate(args.scheduledStart ?? null))
    .input('schedEnd', sql.Time, timeToDate(args.scheduledEnd ?? null))
    .input('notes', sql.NVarChar(500), args.notes ?? null)
    .input('userId', sql.Int, args.userId)
    .query(`
      INSERT INTO dbo.TblEmpAttendance (
        BranchID, EmpID, WorkDate, CheckInTime, Status, LateMinutes,
        ScheduledStartTime, ScheduledEndTime, Notes, CreatedByUserID, CreatedAt
      )
      OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.EmpID, INSERTED.WorkDate,
             INSERTED.Status,
             CONVERT(VARCHAR(8), INSERTED.CheckInTime, 108) AS CheckInTime,
             CONVERT(VARCHAR(8), INSERTED.CheckOutTime, 108) AS CheckOutTime
      VALUES (
        @branchId, @empId, @workDate, @checkIn, @status, @late,
        @schedStart, @schedEnd, @notes, @userId, GETDATE()
      )
    `);
  return mapRow(ins.recordset[0]);
}

/**
 * Check-out against persisted attendance ownership (must match active branch).
 */
export async function checkOutEmployee(
  transaction: Tx,
  args: {
    branchId: number;
    attendanceId: number;
    userId: number;
    checkOutTime: string;
    status?: string;
    earlyLeaveMinutes?: number;
    notes?: string | null;
  },
): Promise<AttendanceRow> {
  await new sql.Request(transaction); // ensure tx
  const loaded = await new sql.Request(transaction)
    .input('id', sql.Int, args.attendanceId)
    .query(`
      SELECT
        ID, BranchID, EmpID, WorkDate, Status,
        CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(8), CheckOutTime, 108) AS CheckOutTime
      FROM dbo.TblEmpAttendance WITH (UPDLOCK, HOLDLOCK)
      WHERE ID = @id
    `);
  if (!loaded.recordset[0]) {
    throw new AttendanceDomainError('NOT_FOUND', 'غير موجود', 404);
  }
  const row = mapRow(loaded.recordset[0]);
  if (row.branchId !== args.branchId) {
    throw new AttendanceDomainError('NOT_FOUND', 'غير موجود', 404);
  }

  await acquireEmployeeAttendanceLock(transaction, row.empId);

  if (row.checkOutTime) {
    return row; // idempotent
  }
  if (!row.checkInTime) {
    throw new AttendanceDomainError('NO_CHECKIN', 'لا يوجد وقت حضور', 400);
  }

  await new sql.Request(transaction)
    .input('id', sql.Int, args.attendanceId)
    .input('branchId', sql.Int, args.branchId)
    .input('checkOut', sql.Time, timeToDate(args.checkOutTime))
    .input('status', sql.NVarChar(50), args.status || row.status)
    .input('early', sql.Int, args.earlyLeaveMinutes ?? 0)
    .input('notes', sql.NVarChar(500), args.notes ?? null)
    .input('userId', sql.Int, args.userId)
    .query(`
      UPDATE dbo.TblEmpAttendance
      SET CheckOutTime = @checkOut,
          Status = @status,
          EarlyLeaveMinutes = @early,
          Notes = COALESCE(@notes, Notes),
          UpdatedByUserID = @userId,
          UpdatedAt = GETDATE()
      WHERE ID = @id AND BranchID = @branchId
    `);

  const after = await new sql.Request(transaction)
    .input('id', sql.Int, args.attendanceId)
    .query(`
      SELECT
        ID, BranchID, EmpID, WorkDate, Status,
        CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(8), CheckOutTime, 108) AS CheckOutTime
      FROM dbo.TblEmpAttendance WHERE ID = @id
    `);
  return mapRow(after.recordset[0]);
}

export async function loadAttendanceOwnedByBranch(
  transaction: Tx | { request: () => sql.Request },
  attendanceId: number,
  branchId: number,
): Promise<AttendanceRow | null> {
  const req =
    transaction instanceof sql.Transaction
      ? new sql.Request(transaction)
      : transaction.request();
  const result = await req.input('id', sql.Int, attendanceId).query(`
    SELECT
      ID, BranchID, EmpID, WorkDate, Status,
      CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime,
      CONVERT(VARCHAR(8), CheckOutTime, 108) AS CheckOutTime
    FROM dbo.TblEmpAttendance WHERE ID = @id
  `);
  if (!result.recordset[0]) return null;
  const row = mapRow(result.recordset[0]);
  if (row.branchId !== branchId) return null;
  return row;
}
