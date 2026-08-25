/**
 * SQL persistence for attendance commands (Phase B1 admin PUT, Phase B2 employees POST).
 * Repository = SQL only. OPEN predicate is legacy other-branch / any WorkDate.
 */
import { getPool, sql } from '@/lib/db';
import { ensureAttendanceBreakSchema } from '@/lib/hr/attendance-breaks-db';
import { ensureAttendanceBreakTimeSchema } from '@/lib/hr/attendance-break-time-db';

export type AttendanceDb = { request: () => sql.Request };

export type EmpScheduleRow = {
  EmpName: string | null;
  EmploymentType: unknown;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  ScheduleDayOfWeek: number | null;
  IsWorkingDay: boolean | null;
  ScheduleStartTime: string | null;
  ScheduleEndTime: string | null;
};

export type ExistingAttendanceRow = {
  ID: number;
  CheckInTime: string | null;
  CheckOutTime: string | null;
};

export function timeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  const parts = timeStr.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  const d = new Date(0);
  d.setUTCHours(h, m, s, 0);
  return d;
}

export async function getAttendanceDb(): Promise<AttendanceDb> {
  return getPool();
}

export type AttendanceTransaction = {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

/** One SQL transaction for admin bulk. Caller owns commit/rollback. */
export async function beginAttendanceTransaction(): Promise<{
  transaction: AttendanceTransaction;
  txDb: AttendanceDb;
}> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  return {
    transaction,
    txDb: { request: () => new sql.Request(transaction) },
  };
}

/**
 * Bulk TblEmp defaults.
 * TECHNICAL DEBT (do not fix in B4): IN-list is string-concatenated from empIds,
 * matching current production SQL. Parameterize separately.
 */
export async function loadBulkEmpDefaults(
  db: AttendanceDb,
  empIds: unknown[],
): Promise<
  Array<{
    EmpID: number;
    EmpName: string | null;
    DefaultCheckInTime: string | null;
    DefaultCheckOutTime: string | null;
  }>
> {
  const empIdsSql = empIds.map((id) => Number(id)).join(',') || '0';
  const empDefaults = await db.request().query(`
        SELECT
          EmpID,
          EmpName,
          CONVERT(VARCHAR(5), DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
        FROM dbo.TblEmp
        WHERE EmpID IN (${empIdsSql})
      `);
  return empDefaults.recordset;
}

export async function ensureAttendanceTable(db: AttendanceDb): Promise<void> {
  await db.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'TblEmpAttendance')
    BEGIN
        CREATE TABLE dbo.TblEmpAttendance (
            ID INT IDENTITY(1,1) PRIMARY KEY,
            BranchID INT NOT NULL,
            EmpID INT NOT NULL,
            WorkDate DATE NOT NULL,
            ScheduledStartTime TIME NULL,
            ScheduledEndTime TIME NULL,
            CheckInTime TIME NULL,
            CheckOutTime TIME NULL,
            Status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
            LateMinutes INT NOT NULL DEFAULT 0,
            EarlyLeaveMinutes INT NOT NULL DEFAULT 0,
            Notes NVARCHAR(500) NULL,
            CreatedByUserID INT NULL,
            UpdatedByUserID INT NULL,
            CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
            UpdatedAt DATETIME NULL
        );

        ALTER TABLE dbo.TblEmpAttendance
        ADD CONSTRAINT FK_TblEmpAttendance_TblEmp
        FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID);

        ALTER TABLE dbo.TblEmpAttendance
        ADD CONSTRAINT FK_TblEmpAttendance_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch(BranchID);

        CREATE UNIQUE INDEX UQ_TblEmpAttendance_Branch_Emp_WorkDate
        ON dbo.TblEmpAttendance (BranchID, EmpID, WorkDate);

        CREATE INDEX IX_TblEmpAttendance_Branch_WorkDate
        ON dbo.TblEmpAttendance (BranchID, WorkDate);
    END
  `);
  await ensureAttendanceBreakSchema(db);
  await ensureAttendanceBreakTimeSchema(db);
}

/** Legacy OPEN: other branch, CheckIn set, CheckOut null, any WorkDate. No ORDER BY.
 * @deprecated Prefer listOpenSessionsForEmployee + evaluateActiveOpenCreation (WorkDate-scoped).
 */
export async function findOtherBranchOpenAttendance(
  db: AttendanceDb,
  empId: unknown,
  branchId: number,
): Promise<{ ID: number; BranchID: number; WorkDate: unknown } | null> {
  const openOther = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .query(`
          SELECT TOP 1 ID, BranchID, WorkDate
          FROM dbo.TblEmpAttendance
          WHERE EmpID = @empId
            AND CheckInTime IS NOT NULL
            AND CheckOutTime IS NULL
            AND BranchID <> @branchId
        `);
  return openOther.recordset[0] ?? null;
}

/**
 * Employee-scoped exclusive applock for active-session invariant.
 * Resource: attendance-active-session:{EmpID}
 */
export async function acquireEmployeeActiveSessionLock(
  db: AttendanceDb,
  empId: number,
  lockResource: string,
  lockTimeoutMs = 5000,
): Promise<void> {
  const lockResult = await db
    .request()
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
  const result = Number(lockResult.recordset[0]?.lockResult ?? -1);
  if (result < 0) {
    const { AttendanceCommandError } = await import('../domain/adminPutAttendance');
    throw new AttendanceCommandError(
      'سجل الحضور مشغول — أعد المحاولة بعد لحظات',
      503,
      'ATTENDANCE_BUSY',
    );
  }
}

export async function loadEmployeeScheduleForAdminPut(
  db: AttendanceDb,
  empId: unknown,
  workDate: string,
  branchId: number,
): Promise<EmpScheduleRow | null> {
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getDay();
  const empResult = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('dayOfWeek', sql.TinyInt, dayOfWeek)
    .input('workDate', sql.Date, workDate)
    .input('branchId', sql.Int, branchId).query(`
        SELECT
          e.EmpName,
          e.EmploymentType,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          ws.ScheduleDayOfWeek,
          ws.IsWorkingDay,
          ws.ScheduleStartTime,
          ws.ScheduleEndTime
        FROM dbo.TblEmp e
        OUTER APPLY (
          SELECT TOP 1
            s.DayOfWeek AS ScheduleDayOfWeek,
            CAST(s.IsWorking AS bit) AS IsWorkingDay,
            CONVERT(VARCHAR(5), s.StartTime, 108) AS ScheduleStartTime,
            CONVERT(VARCHAR(5), s.EndTime, 108) AS ScheduleEndTime
          FROM dbo.TblEmpBranchWorkSchedule s
          WHERE s.EmpID = e.EmpID
            AND s.BranchID = @branchId
            AND s.DayOfWeek = @dayOfWeek
            AND s.IsActive = 1
            AND s.EffectiveFrom <= @workDate
            AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= @workDate)
          ORDER BY s.EffectiveFrom DESC, s.ScheduleID DESC
        ) ws
        WHERE e.EmpID = @empId
      `);
  return empResult.recordset[0] ?? null;
}

export async function findBranchDayAttendance(
  db: AttendanceDb,
  empId: unknown,
  workDate: string,
  branchId: number,
): Promise<ExistingAttendanceRow | null> {
  const existing = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, workDate)
    .input('branchId', sql.Int, branchId).query(`
        SELECT
          ID,
          CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
          CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOutTime
        FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
      `);
  return existing.recordset[0] ?? null;
}

export async function updateBranchDayAttendance(args: {
  db: AttendanceDb;
  id: number;
  branchId: number;
  checkInTime: string | null | undefined;
  checkOutTime: string | null | undefined;
  status: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  notes: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  updatedBy: number | null;
}): Promise<void> {
  const { db } = args;
  await db
    .request()
    .input('id', sql.Int, args.id)
    .input('branchId', sql.Int, args.branchId)
    .input('checkInTime', sql.Time, timeToDate(args.checkInTime))
    .input('checkOutTime', sql.Time, timeToDate(args.checkOutTime))
    .input('status', sql.NVarChar(50), args.status)
    .input('lateMinutes', sql.Int, args.lateMinutes)
    .input('earlyLeaveMinutes', sql.Int, args.earlyLeaveMinutes)
    .input('notes', sql.NVarChar(500), args.notes)
    .input('scheduledStart', sql.Time, timeToDate(args.scheduledStart))
    .input('scheduledEnd', sql.Time, timeToDate(args.scheduledEnd))
    .input('updatedBy', sql.Int, args.updatedBy).query(`
          UPDATE dbo.TblEmpAttendance
          SET CheckInTime = @checkInTime,
              CheckOutTime = @checkOutTime,
              Status = @status,
              LateMinutes = @lateMinutes,
              EarlyLeaveMinutes = @earlyLeaveMinutes,
              Notes = @notes,
              ScheduledStartTime = @scheduledStart,
              ScheduledEndTime = @scheduledEnd,
              UpdatedByUserID = @updatedBy,
              UpdatedAt = GETDATE()
          WHERE ID = @id AND BranchID = @branchId
        `);
}

/** Current employees POST existence check. Distinct from schedule JOIN used by admin PUT. */
export async function employeeExists(
  db: AttendanceDb,
  empId: unknown,
): Promise<boolean> {
  const empCheck = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`SELECT 1 FROM dbo.TblEmp WHERE EmpID = @empId`);
  return empCheck.recordset.length > 0;
}

/**
 * Legacy employees POST upsert: MERGE + ISNULL (partial update).
 * Omitted/null punches/status/notes keep existing values. Not admin PUT overwrite.
 */
export async function mergeLegacyEmployeeAttendance(args: {
  db: AttendanceDb;
  branchId: number;
  empId: unknown;
  workDate: unknown;
  checkInTime: unknown;
  checkOutTime: unknown;
  status: unknown;
  notes: unknown;
}): Promise<Record<string, unknown> | undefined> {
  const { db } = args;
  const result = await db
    .request()
    .input('branchId', sql.Int, args.branchId)
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('checkInTime', sql.Time, timeToDate(args.checkInTime as string | null | undefined))
    .input('checkOutTime', sql.Time, timeToDate(args.checkOutTime as string | null | undefined))
    .input('status', sql.NVarChar(20), args.status ?? null)
    .input('notes', sql.NVarChar(200), args.notes ?? null)
    .query(`
        MERGE dbo.TblEmpAttendance AS target
        USING (
          SELECT @branchId AS BranchID, @empId AS EmpID, @workDate AS WorkDate
        ) AS src
          ON target.BranchID = src.BranchID
         AND target.EmpID = src.EmpID
         AND target.WorkDate = src.WorkDate
        WHEN MATCHED THEN
          UPDATE SET
            CheckInTime  = ISNULL(@checkInTime,  target.CheckInTime),
            CheckOutTime = ISNULL(@checkOutTime, target.CheckOutTime),
            Status       = ISNULL(@status,       target.Status),
            Notes        = ISNULL(@notes,        target.Notes),
            UpdatedAt    = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (BranchID, EmpID, WorkDate, CheckInTime, CheckOutTime, Status, Notes, CreatedAt)
          VALUES (@branchId, @empId, @workDate, @checkInTime, @checkOutTime, @status, @notes, GETDATE())
        OUTPUT
          INSERTED.ID, INSERTED.BranchID, INSERTED.EmpID, INSERTED.WorkDate,
          INSERTED.CheckInTime, INSERTED.CheckOutTime,
          INSERTED.Status, INSERTED.Notes, INSERTED.CreatedAt, INSERTED.UpdatedAt;
      `);
  return result.recordset[0];
}

export type AttendanceOwnershipRow = {
  ID: number;
  BranchID: number;
  EmpID: number;
  WorkDate: unknown;
  CheckInTime: string | null;
  CheckOutTime: string | null;
};

/** Lookup by ID only. Caller decides session-branch ownership. */
export async function getAttendanceOwnershipById(
  db: AttendanceDb,
  id: number,
): Promise<AttendanceOwnershipRow | null> {
  const owned = await db
    .request()
    .input('id', sql.Int, id)
    .query(`
        SELECT
          ID, BranchID, EmpID, WorkDate,
          CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime,
          CONVERT(VARCHAR(8), CheckOutTime, 108) AS CheckOutTime
        FROM dbo.TblEmpAttendance WHERE ID = @id
      `);
  const row = owned.recordset[0];
  if (!row) return null;
  return {
    ID: Number(row.ID),
    BranchID: Number(row.BranchID),
    EmpID: Number(row.EmpID),
    WorkDate: row.WorkDate,
    CheckInTime: row.CheckInTime == null ? null : String(row.CheckInTime),
    CheckOutTime: row.CheckOutTime == null ? null : String(row.CheckOutTime),
  };
}

/**
 * Legacy PUT :id partial UPDATE. NVarChar punches. Null SETs NULL (clear).
 * Only keys present on `patch` are written. Not MERGE+ISNULL.
 */
export async function updateLegacyAttendanceById(args: {
  db: AttendanceDb;
  id: number;
  branchId: number;
  patch: {
    checkInTime?: unknown;
    checkOutTime?: unknown;
    status?: unknown;
    notes?: unknown;
  };
}): Promise<Record<string, unknown> | undefined> {
  const { db, patch } = args;
  const setClauses: string[] = ['UpdatedAt = GETDATE()'];
  const request = db.request();

  if ('checkInTime' in patch) {
    setClauses.push('CheckInTime  = @checkInTime');
    request.input('checkInTime', sql.NVarChar(10), patch.checkInTime);
  }
  if ('checkOutTime' in patch) {
    setClauses.push('CheckOutTime = @checkOutTime');
    request.input('checkOutTime', sql.NVarChar(10), patch.checkOutTime);
  }
  if ('status' in patch) {
    setClauses.push('Status       = @status');
    request.input('status', sql.NVarChar(20), patch.status);
  }
  if ('notes' in patch) {
    setClauses.push('Notes        = @notes');
    request.input('notes', sql.NVarChar(200), patch.notes);
  }

  request.input('id', sql.Int, args.id);
  request.input('branchId', sql.Int, args.branchId);
  const result = await request.query(`
      UPDATE dbo.TblEmpAttendance
      SET    ${setClauses.join(', ')}
      OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.EmpID, INSERTED.WorkDate,
             INSERTED.CheckInTime, INSERTED.CheckOutTime,
             INSERTED.Status, INSERTED.Notes, INSERTED.UpdatedAt
      WHERE  ID = @id AND BranchID = @branchId
    `);
  return result.recordset[0];
}

export async function insertBranchDayAttendance(args: {
  db: AttendanceDb;
  branchId: number;
  empId: unknown;
  workDate: string;
  checkInTime: string | null | undefined;
  checkOutTime: string | null | undefined;
  status: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  notes: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  createdBy: number | null;
}): Promise<number> {
  const { db } = args;
  const insertResult = await db
    .request()
    .input('branchId', sql.Int, args.branchId)
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('checkInTime', sql.Time, timeToDate(args.checkInTime))
    .input('checkOutTime', sql.Time, timeToDate(args.checkOutTime))
    .input('status', sql.NVarChar(50), args.status)
    .input('lateMinutes', sql.Int, args.lateMinutes)
    .input('earlyLeaveMinutes', sql.Int, args.earlyLeaveMinutes)
    .input('notes', sql.NVarChar(500), args.notes)
    .input('scheduledStart', sql.Time, timeToDate(args.scheduledStart))
    .input('scheduledEnd', sql.Time, timeToDate(args.scheduledEnd))
    .input('createdBy', sql.Int, args.createdBy).query(`
          INSERT INTO dbo.TblEmpAttendance
            (BranchID, EmpID, WorkDate, CheckInTime, CheckOutTime, Status, LateMinutes, EarlyLeaveMinutes, Notes, ScheduledStartTime, ScheduledEndTime, CreatedByUserID, CreatedAt)
          OUTPUT INSERTED.ID
          VALUES
            (@branchId, @empId, @workDate, @checkInTime, @checkOutTime, @status, @lateMinutes, @earlyLeaveMinutes, @notes, @scheduledStart, @scheduledEnd, @createdBy, GETDATE())
        `);
  return insertResult.recordset[0].ID as number;
}

/**
 * Ops restore-present today punch (Phase B5).
 * Session-branch Present upsert + cross-branch tagged day_off Absent patch.
 * No OPEN check. VarChar check-in. Exact production SQL.
 */
export async function upsertRestorePresentAttendance(args: {
  db: AttendanceDb;
  empId: number;
  workDate: string;
  branchId: number;
  checkInTime: string;
  notes: string;
  dayOffTag: string;
}): Promise<void> {
  const { db } = args;
  const checkIn =
    args.checkInTime.length === 5 ? `${args.checkInTime}:00` : args.checkInTime;
  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('branchId', sql.Int, args.branchId)
    .input('checkIn', sql.VarChar(8), checkIn)
    .input('status', sql.NVarChar(40), 'Present')
    .input('notes', sql.NVarChar(300), args.notes)
    .input('dayOffTag', sql.NVarChar(80), args.dayOffTag).query(`
          IF EXISTS (
            SELECT 1 FROM dbo.TblEmpAttendance
            WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
          )
          BEGIN
            UPDATE dbo.TblEmpAttendance
            SET
              Status = @status,
              CheckInTime = CASE
                WHEN CheckInTime IS NULL THEN TRY_CAST(@checkIn AS TIME)
                WHEN Status = N'Absent' THEN TRY_CAST(@checkIn AS TIME)
                ELSE CheckInTime
              END,
              CheckOutTime = CASE WHEN Status = N'Absent' THEN NULL ELSE CheckOutTime END,
              Notes = @notes,
              UpdatedAt = SYSUTCDATETIME()
            WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
          END
          ELSE
          BEGIN
            INSERT INTO dbo.TblEmpAttendance
              (BranchID, EmpID, WorkDate, CheckInTime, Status, Notes, CreatedAt)
            VALUES
              (@branchId, @empId, @workDate, TRY_CAST(@checkIn AS TIME), @status, @notes, GETDATE())
          END

          UPDATE dbo.TblEmpAttendance
          SET Status = @status,
              CheckInTime = ISNULL(CheckInTime, TRY_CAST(@checkIn AS TIME)),
              Notes = @notes,
              UpdatedAt = SYSUTCDATETIME()
          WHERE EmpID = @empId
            AND WorkDate = @workDate
            AND Status = N'Absent'
            AND BranchID <> @branchId
            AND Notes LIKE @dayOffTag + N'%'
        `);
}

/**
 * Schedule-control apply day_off → Absent upsert (Phase B6).
 * Clears punches. Session-branch scoped. Exact production SQL.
 */
export async function upsertScheduleControlDayOffAbsent(args: {
  db: AttendanceDb;
  empId: number;
  workDate: string;
  branchId: number;
  notes: string;
}): Promise<void> {
  const { db } = args;
  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('branchId', sql.Int, args.branchId)
    .input('notes', sql.NVarChar(300), args.notes).query(`
          IF EXISTS (
            SELECT 1 FROM dbo.TblEmpAttendance
            WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
          )
            UPDATE dbo.TblEmpAttendance
            SET Status = 'Absent', Notes = @notes,
                CheckInTime = NULL, CheckOutTime = NULL
            WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
          ELSE
            INSERT INTO dbo.TblEmpAttendance (BranchID, EmpID, WorkDate, Status, Notes)
            VALUES (@branchId, @empId, @workDate, 'Absent', @notes)
        `);
}

/**
 * Schedule-control override DELETE → clear tagged Absent (Phase B6).
 * No BranchID filter. Status/Notes set NULL. Exact production SQL.
 */
export async function revertTaggedScheduleControlDayOffAbsent(args: {
  db: AttendanceDb;
  empId: number;
  workDate: string;
  sourceTag: string;
}): Promise<number> {
  const { db } = args;
  const result = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('sourceTag', sql.NVarChar(100), args.sourceTag).query(`
          UPDATE dbo.TblEmpAttendance
          SET Status = NULL, Notes = NULL
          WHERE EmpID = @empId
            AND WorkDate = @workDate
            AND Status = 'Absent'
            AND Notes LIKE @sourceTag + '%'
        `);
  return Number(result.rowsAffected?.[0] ?? 0);
}

/**
 * Auto-absence mark Absent — BranchID + EmpID + WorkDate scoped (policy cutover).
 * Intentional fix: no longer branch-blind EmpID+WorkDate.
 */
export async function markAutoAbsenceAttendance(args: {
  db: AttendanceDb;
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<void> {
  const { db } = args;
  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('date', sql.Date, args.workDate)
    .query(`
          IF NOT EXISTS (
            SELECT 1 FROM dbo.TblEmpAttendance
            WHERE EmpID = @empId AND WorkDate = @date AND BranchID = @branchId
          )
            INSERT INTO dbo.TblEmpAttendance (
              EmpID, BranchID, WorkDate, Status, Notes, CreatedAt
            )
            VALUES (
              @empId, @branchId, @date, N'Absent',
              N'AUTO_ABSENCE after scheduled start + threshold',
              SYSUTCDATETIME()
            );
          ELSE
            UPDATE dbo.TblEmpAttendance
            SET Status = N'Absent',
                Notes = LEFT(CONCAT(ISNULL(Notes,N''), N' | AUTO_ABSENCE'), 250)
            WHERE EmpID = @empId AND WorkDate = @date AND BranchID = @branchId
              AND Status NOT IN (N'Present', N'Late', N'EarlyLeave');
        `);
}

function timeToDateForNightly(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  const parts = timeStr.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  const d = new Date(0);
  d.setUTCHours(h, m, s, 0);
  return d;
}

/**
 * Nightly finalize UPDATE — branch-scoped by ID + BranchID. Exact production SQL.
 */
export async function updateNightlyDefaultFillAttendance(args: {
  db: AttendanceDb;
  attendanceId: number;
  branchId: number;
  checkInTime: string;
  checkOutTime: string;
  status: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  notes: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
}): Promise<void> {
  const { db } = args;
  await db
    .request()
    .input('id', sql.Int, args.attendanceId)
    .input('branchId', sql.Int, args.branchId)
    .input('checkInTime', sql.Time, timeToDateForNightly(args.checkInTime))
    .input('checkOutTime', sql.Time, timeToDateForNightly(args.checkOutTime))
    .input('status', sql.NVarChar(50), args.status)
    .input('lateMinutes', sql.Int, args.lateMinutes)
    .input('earlyLeaveMinutes', sql.Int, args.earlyLeaveMinutes)
    .input('notes', sql.NVarChar(500), args.notes)
    .input('scheduledStart', sql.Time, timeToDateForNightly(args.scheduledStart))
    .input('scheduledEnd', sql.Time, timeToDateForNightly(args.scheduledEnd))
    .query(`
            UPDATE dbo.TblEmpAttendance
            SET
              CheckInTime = @checkInTime,
              CheckOutTime = @checkOutTime,
              Status = @status,
              LateMinutes = @lateMinutes,
              EarlyLeaveMinutes = @earlyLeaveMinutes,
              ScheduledStartTime = ISNULL(ScheduledStartTime, @scheduledStart),
              ScheduledEndTime = ISNULL(ScheduledEndTime, @scheduledEnd),
              Notes = CASE
                WHEN Notes IS NULL OR LTRIM(RTRIM(Notes)) = N'' THEN @notes
                ELSE Notes + N' | ' + @notes
              END,
              UpdatedAt = GETDATE()
            WHERE ID = @id AND BranchID = @branchId
          `);
}

/**
 * Nightly finalize INSERT — branch-scoped create. Exact production SQL.
 */
export async function insertNightlyDefaultFillAttendance(args: {
  db: AttendanceDb;
  branchId: number;
  empId: number;
  workDate: string;
  checkInTime: string;
  checkOutTime: string;
  status: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  notes: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
}): Promise<void> {
  const { db } = args;
  await db
    .request()
    .input('branchId', sql.Int, args.branchId)
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('checkInTime', sql.Time, timeToDateForNightly(args.checkInTime))
    .input('checkOutTime', sql.Time, timeToDateForNightly(args.checkOutTime))
    .input('status', sql.NVarChar(50), args.status)
    .input('lateMinutes', sql.Int, args.lateMinutes)
    .input('earlyLeaveMinutes', sql.Int, args.earlyLeaveMinutes)
    .input('notes', sql.NVarChar(500), args.notes)
    .input('scheduledStart', sql.Time, timeToDateForNightly(args.scheduledStart))
    .input('scheduledEnd', sql.Time, timeToDateForNightly(args.scheduledEnd))
    .query(`
            INSERT INTO dbo.TblEmpAttendance
              (BranchID, EmpID, WorkDate, CheckInTime, CheckOutTime, Status,
               LateMinutes, EarlyLeaveMinutes, Notes,
               ScheduledStartTime, ScheduledEndTime, CreatedAt)
            VALUES
              (@branchId, @empId, @workDate, @checkInTime, @checkOutTime, @status,
               @lateMinutes, @earlyLeaveMinutes, @notes,
               @scheduledStart, @scheduledEnd, GETDATE())
          `);
}

/**
 * CLOSED-only relocate from→to (CheckIn AND CheckOut NOT NULL).
 * Used by temporary transfer + relocateEmployeeDayBranch. Exact production SQL.
 */
export async function relocateClosedAttendanceFromBranch(args: {
  db: AttendanceDb;
  empId: number;
  workDate: string;
  fromBranchId: number;
  toBranchId: number;
}): Promise<number> {
  const { db } = args;
  const result = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('from', sql.Int, args.fromBranchId)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      UPDATE dbo.TblEmpAttendance
      SET BranchID = @to
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @from
        AND CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL
    `);
  return Number(result.rowsAffected?.[0] ?? 0);
}

/**
 * CLOSED-only sweep: any BranchID <> destination → destination.
 * Temporary transfer third-branch cleanup. Exact production SQL.
 */
export async function relocateClosedAttendanceTowardDestination(args: {
  db: AttendanceDb;
  empId: number;
  workDate: string;
  toBranchId: number;
}): Promise<number> {
  const { db } = args;
  const result = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      UPDATE dbo.TblEmpAttendance
      SET BranchID = @to
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID <> @to
        AND CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL
    `);
  return Number(result.rowsAffected?.[0] ?? 0);
}

/**
 * Present placeholder for break attach (no punches). Exact production SQL.
 */
export async function ensurePresentAttendancePlaceholder(args: {
  db: AttendanceDb;
  empId: number;
  workDate: string;
  branchId: number;
}): Promise<number> {
  const { db } = args;
  const existing = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT ID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
    `);

  if (existing.recordset.length > 0) {
    return existing.recordset[0].ID as number;
  }

  const inserted = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      INSERT INTO dbo.TblEmpAttendance (BranchID, EmpID, WorkDate, Status, Notes, CreatedAt)
      OUTPUT INSERTED.ID
      VALUES (@branchId, @empId, @workDate, N'Present', NULL, GETDATE())
    `);

  return inserted.recordset[0].ID as number;
}

/**
 * Work-on-day-off Present upsert. No OPEN check. Exact production SQL.
 */
export async function upsertWorkOnDayOffPresent(args: {
  db: AttendanceDb;
  empId: number;
  workDate: string;
  branchId: number;
  checkInTime: string;
  notes: string;
}): Promise<void> {
  const { db } = args;
  const checkIn =
    args.checkInTime.length === 5 ? `${args.checkInTime}:00` : args.checkInTime;
  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('workDate', sql.Date, args.workDate)
    .input('branchId', sql.Int, args.branchId)
    .input('checkIn', sql.VarChar(8), checkIn)
    .input('status', sql.NVarChar(40), 'Present')
    .input('notes', sql.NVarChar(300), args.notes)
    .query(`
      IF EXISTS (
        SELECT 1 FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
      )
      BEGIN
        UPDATE dbo.TblEmpAttendance
        SET
          Status = @status,
          CheckInTime = CASE
            WHEN CheckInTime IS NULL THEN TRY_CAST(@checkIn AS TIME)
            WHEN Status IN (N'Absent', N'DayOff', N'Pending') THEN TRY_CAST(@checkIn AS TIME)
            ELSE CheckInTime
          END,
          CheckOutTime = CASE
            WHEN Status IN (N'Absent', N'DayOff') THEN NULL
            ELSE CheckOutTime
          END,
          Notes = @notes,
          UpdatedAt = SYSUTCDATETIME()
        WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
      END
      ELSE
      BEGIN
        INSERT INTO dbo.TblEmpAttendance
          (BranchID, EmpID, WorkDate, CheckInTime, Status, Notes, CreatedAt)
        VALUES
          (@branchId, @empId, @workDate, TRY_CAST(@checkIn AS TIME), @status, @notes, GETDATE())
      END
    `);
}
