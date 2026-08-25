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
  const lockResource = `attendance-active-session:${empId}`;
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
  const { getSmokeExecutionContext } = await import('@/lib/branch/smokeExecutionContext');
  const smoke = getSmokeExecutionContext();
  let assignments = await listEmployeeActiveBranchAssignments(empId, at);
  if (smoke && smoke.branchId === branchId && assignments.every((a) => a.branchId !== branchId)) {
    const { listEmployeeAssignmentsForSmokeBranch } = await import('@/lib/branch/repository');
    assignments = await listEmployeeAssignmentsForSmokeBranch(empId, branchId, at);
  }
  const ok = assignments.some((a) => a.branchId === branchId && a.isActive);
  if (!ok) {
    throw new AttendanceDomainError(
      'ASSIGNMENT_REQUIRED',
      'الموظف غير مُعيَّن لهذا الفرع في تاريخ العمل',
      403,
    );
  }

  // Align with GET /api/admin/attendance board eligibility:
  // working branch schedule OR existing attendance row OR temporary transfer in.
  // Do not hard-fail solely on global leave / resolver isWorking=false when the
  // employee is still on the board (that caused 403 on bulk save for past dates).
  const { resolveEmployeeBranchSchedule, resolveEmployeeGlobalSchedule } = await import(
    '@/lib/hr/employeeBranchScheduleResolver'
  );
  const { getEffectiveBranchScheduleRow } = await import('@/lib/hr/empBranchWorkSchedule');

  const branchSched = await resolveEmployeeBranchSchedule({ empId, branchId, workDate });
  if (branchSched?.isWorking) return;

  const existingAtt = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1 ID
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);
  if (existingAtt.recordset[0]) return;

  // Transferred away from this branch after window start → block new check-in here
  // (must run before weekly-schedule bypass below)
  const xferAway = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1
             CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
             CONVERT(VARCHAR(5), EndTime, 108) AS EndTime
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID = @empId
        AND WorkDate = @workDate
        AND IsActive = 1
        AND FromBranchID = @branchId
    `);
  if (xferAway.recordset[0]) {
    const { isTransferSourceInactive } = await import('@/lib/hr/temporaryTransferWindow');
    if (
      isTransferSourceInactive({
        workDate,
        startTime: xferAway.recordset[0].StartTime
          ? String(xferAway.recordset[0].StartTime).slice(0, 5)
          : null,
        endTime: xferAway.recordset[0].EndTime
          ? String(xferAway.recordset[0].EndTime).slice(0, 5)
          : null,
      })
    ) {
      throw new AttendanceDomainError(
        'EMPLOYEE_TRANSFERRED_AWAY',
        'الموظف منقول لفرع آخر في هذه الفترة — سجّل الحضور من الفرع المنقول إليه',
        403,
      );
    }
  }

  // Branch weekly schedule says working (even if resolver marked global leave)
  const scheduleRow = await getEffectiveBranchScheduleRow({ empId, branchId, workDate });
  if (scheduleRow?.isWorking) return;

  // Temporary transfer into this branch — only after destination window starts
  const xfer = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1 TransferID, FromBranchID,
             CONVERT(VARCHAR(5), StartTime, 108) AS StartTime,
             CONVERT(VARCHAR(5), EndTime, 108) AS EndTime
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID = @empId
        AND WorkDate = @workDate
        AND IsActive = 1
        AND ToBranchID = @branchId
    `);
  if (xfer.recordset[0]) {
    const { isTransferDestinationActive } = await import('@/lib/hr/temporaryTransferWindow');
    const active = isTransferDestinationActive({
      workDate,
      startTime: xfer.recordset[0].StartTime
        ? String(xfer.recordset[0].StartTime).slice(0, 5)
        : null,
      endTime: xfer.recordset[0].EndTime
        ? String(xfer.recordset[0].EndTime).slice(0, 5)
        : null,
    });
    if (active) {
      // Must close open attendance at the source branch before checking in here
      const openSrc = await db
        .request()
        .input('empId', sql.Int, empId)
        .input('fromBranchId', sql.Int, Number(xfer.recordset[0].FromBranchID))
        .input('workDate', sql.Date, workDate)
        .query(`
          SELECT TOP 1 ID
          FROM dbo.TblEmpAttendance
          WHERE EmpID = @empId
            AND BranchID = @fromBranchId
            AND WorkDate = @workDate
            AND CheckInTime IS NOT NULL
            AND CheckOutTime IS NULL
        `);
      if (openSrc.recordset[0]) {
        throw new AttendanceDomainError(
          'TRANSFER_SOURCE_STILL_OPEN',
          'اقفل حضور الفرع السابق (تسجيل انصراف) قبل فتح الحضور في الفرع المنقول إليه',
          409,
        );
      }
      return;
    }
  }

  const global = await resolveEmployeeGlobalSchedule({ empId, workDate, publicOnly: false });
  if (global.isGloballyWorking && global.branches[0]?.branchId !== branchId) {
    const other = global.branches[0];
    throw new AttendanceDomainError(
      'EMPLOYEE_NOT_SCHEDULED_IN_THIS_BRANCH',
      `الموظف مجدول في فرع آخر في هذا اليوم (${other?.branchCode ?? ''}). سجّل الحضور من ذلك الفرع أو استخدم «نقل موظف اليوم».`,
      403,
    );
  }

  // Assigned here and not working at another branch → OK.
  // Weekly day-off / came to work on leave is normal shop practice.
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

  const openResult = await new sql.Request(transaction)
    .input('empId', sql.Int, args.empId)
    .query(`
      SELECT
        ID, BranchID, EmpID, WorkDate, Status,
        CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(8), CheckOutTime, 108) AS CheckOutTime
      FROM dbo.TblEmpAttendance WITH (UPDLOCK, HOLDLOCK)
      WHERE EmpID = @empId
        AND CheckInTime IS NOT NULL
        AND CheckOutTime IS NULL
      ORDER BY WorkDate DESC, ID DESC
    `);
  const openSessions = (openResult.recordset as Array<Record<string, unknown>>).map(
    (row) => {
      const mapped = mapRow(row);
      return {
        attendanceId: mapped.id,
        employeeId: mapped.empId,
        branchId: mapped.branchId,
        workDate: mapped.workDate,
        checkInTime: mapped.checkInTime,
      };
    },
  );

  const sameBranchDate = openSessions.find(
    (s) => s.branchId === args.branch.branchId && s.workDate === workDate,
  );
  if (sameBranchDate) {
    return mapRow(
      (openResult.recordset as Array<Record<string, unknown>>).find(
        (r) => Number(r.ID) === sameBranchDate.attendanceId,
      )!,
    );
  }

  const { evaluateActiveOpenCreation } = await import(
    '@/modules/attendance/domain/attendanceSessionPolicy'
  );
  const evaluation = evaluateActiveOpenCreation({
    candidateWorkDate: workDate,
    openSessions,
  });
  if (!evaluation.allowed) {
    const conflict = evaluation.conflict!;
    throw new AttendanceDomainError(
      conflict.branchId !== args.branch.branchId
        ? 'EMPLOYEE_ALREADY_CHECKED_IN_OTHER_BRANCH'
        : 'ALREADY_OPEN',
      'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً',
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
