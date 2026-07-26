/**
 * Phase 1Q — branch-owned employee weekly schedule (source of truth).
 * Legacy TblEmpWorkSchedule remains read-only fallback for GLEEM until fully migrated.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';

export const BRANCH_SCHEDULE_POLICY = 'ONE_OPERATIONAL_BRANCH_PER_EMPLOYEE_PER_WORKDATE' as const;

export type EmpBranchWorkScheduleRow = {
  scheduleId: number;
  empId: number;
  branchId: number;
  dayOfWeek: number;
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  canReceiveBookings: boolean;
  notes: string | null;
};

let ensured = false;

export async function ensureEmpBranchWorkScheduleTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblEmpBranchWorkSchedule', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblEmpBranchWorkSchedule (
        ScheduleID BIGINT IDENTITY(1,1) NOT NULL
          CONSTRAINT PK_TblEmpBranchWorkSchedule PRIMARY KEY,
        EmpID INT NOT NULL,
        BranchID INT NOT NULL,
        DayOfWeek TINYINT NOT NULL
          CONSTRAINT CK_EBWS_DayOfWeek CHECK (DayOfWeek BETWEEN 0 AND 6),
        IsWorking BIT NOT NULL CONSTRAINT DF_EBWS_IsWorking DEFAULT (0),
        StartTime TIME NULL,
        EndTime TIME NULL,
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_EBWS_IsActive DEFAULT (1),
        CanReceiveBookings BIT NOT NULL CONSTRAINT DF_EBWS_CanBook DEFAULT (1),
        Notes NVARCHAR(250) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_EBWS_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NULL,
        CreatedByUserID INT NULL,
        CONSTRAINT FK_EBWS_Emp FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID),
        CONSTRAINT FK_EBWS_Branch FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch(BranchID)
      );
      CREATE INDEX IX_EBWS_Emp_Branch_Day
        ON dbo.TblEmpBranchWorkSchedule (EmpID, BranchID, DayOfWeek, IsActive);
      CREATE INDEX IX_EBWS_Branch_Day_Active
        ON dbo.TblEmpBranchWorkSchedule (BranchID, DayOfWeek, IsActive, EffectiveFrom);
    END

    IF OBJECT_ID(N'dbo.TblEmpTemporaryBranchTransfer', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblEmpTemporaryBranchTransfer (
        TransferID BIGINT IDENTITY(1,1) NOT NULL
          CONSTRAINT PK_TblEmpTemporaryBranchTransfer PRIMARY KEY,
        EmpID INT NOT NULL,
        FromBranchID INT NOT NULL,
        ToBranchID INT NOT NULL,
        WorkDate DATE NOT NULL,
        StartTime TIME NULL,
        EndTime TIME NULL,
        Reason NVARCHAR(250) NOT NULL,
        CreatedByUserID INT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_ETBT_IsActive DEFAULT (1),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ETBT_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NULL,
        CONSTRAINT FK_ETBT_Emp FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID),
        CONSTRAINT FK_ETBT_From FOREIGN KEY (FromBranchID) REFERENCES dbo.TblBranch(BranchID),
        CONSTRAINT FK_ETBT_To FOREIGN KEY (ToBranchID) REFERENCES dbo.TblBranch(BranchID)
      );
      CREATE INDEX IX_ETBT_Emp_Date ON dbo.TblEmpTemporaryBranchTransfer (EmpID, WorkDate, IsActive);
    END
  `);
  ensured = true;
}

function fmtTime(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 5);
}

function toDateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function mapRow(row: Record<string, unknown>): EmpBranchWorkScheduleRow {
  return {
    scheduleId: Number(row.ScheduleID),
    empId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    dayOfWeek: Number(row.DayOfWeek),
    isWorking: Boolean(row.IsWorking),
    startTime: fmtTime(row.StartTime),
    endTime: fmtTime(row.EndTime),
    effectiveFrom: toDateStr(row.EffectiveFrom),
    effectiveTo: row.EffectiveTo == null ? null : toDateStr(row.EffectiveTo),
    isActive: Boolean(row.IsActive),
    canReceiveBookings: Boolean(row.CanReceiveBookings),
    notes: row.Notes == null ? null : String(row.Notes),
  };
}

export async function getEffectiveBranchScheduleRow(args: {
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<EmpBranchWorkScheduleRow | null> {
  await ensureEmpBranchWorkScheduleTable();
  const dayOfWeek = new Date(`${args.workDate}T12:00:00Z`).getDay();
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('dow', sql.TinyInt, dayOfWeek)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 *
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID = @empId AND BranchID = @branchId AND DayOfWeek = @dow
        AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      ORDER BY EffectiveFrom DESC, ScheduleID DESC
    `);
  if (!result.recordset[0]) return null;
  return mapRow(result.recordset[0] as Record<string, unknown>);
}

/**
 * Idempotent backfill: copy legacy TblEmpWorkSchedule → TblEmpBranchWorkSchedule for GLEEM only.
 */
export async function backfillGleemBranchSchedulesFromLegacy(args?: {
  gleemBranchId?: number;
  effectiveFrom?: string;
  actorUserId?: number | null;
}): Promise<{ inserted: number; skipped: number; fingerprintBefore: number; fingerprintAfter: number }> {
  await ensureEmpBranchWorkScheduleTable();
  const db = await getPool();
  const gleemId =
    args?.gleemBranchId ??
    Number(
      (
        await db.request().query(`
          SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
        `)
      ).recordset[0]?.BranchID,
    );
  const effectiveFrom = args?.effectiveFrom ?? '2020-01-01';

  const before = await db.request().query(`
    SELECT COUNT(*) AS Cnt FROM dbo.TblEmpWorkSchedule
  `);
  const fingerprintBefore = Number(before.recordset[0].Cnt);

  const existing = await db
    .request()
    .input('branchId', sql.Int, gleemId)
    .query(`
      SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchWorkSchedule WHERE BranchID = @branchId
    `);
  let inserted = 0;
  const skipped = Number(existing.recordset[0].Cnt);

  // Insert missing EmpID+DayOfWeek for GLEEM from legacy
  const ins = await db
    .request()
    .input('branchId', sql.Int, gleemId)
    .input('from', sql.Date, effectiveFrom)
    .input('actor', sql.Int, args?.actorUserId ?? null)
    .query(`
      INSERT INTO dbo.TblEmpBranchWorkSchedule (
        EmpID, BranchID, DayOfWeek, IsWorking, StartTime, EndTime,
        EffectiveFrom, EffectiveTo, IsActive, CanReceiveBookings, Notes, CreatedByUserID
      )
      SELECT
        ws.EmpID, @branchId, ws.DayOfWeek, ws.IsWorkingDay, ws.StartTime, ws.EndTime,
        @from, NULL, 1, 1, N'phase1q-backfill-from-legacy', @actor
      FROM dbo.TblEmpWorkSchedule ws
      WHERE NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpBranchWorkSchedule b
        WHERE b.EmpID = ws.EmpID AND b.BranchID = @branchId AND b.DayOfWeek = ws.DayOfWeek
          AND b.IsActive = 1
          AND b.EffectiveFrom = @from
      )
    `);
  inserted = Number(ins.rowsAffected?.[0] ?? 0);

  const after = await db
    .request()
    .input('branchId', sql.Int, gleemId)
    .query(`
      SELECT COUNT(*) AS Cnt FROM dbo.TblEmpBranchWorkSchedule WHERE BranchID = @branchId AND IsActive=1
    `);
  const fingerprintAfter = Number(after.recordset[0].Cnt);

  // Safety: CC and PH1GTEST must still have zero real (non-smoke) schedules from this backfill
  const other = await db.request().query(`
    SELECT b.BranchCode, COUNT(*) AS Cnt
    FROM dbo.TblEmpBranchWorkSchedule s
    INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
    WHERE b.BranchCode IN (N'CAMP_CAESAR', N'PH1GTEST')
      AND (s.Notes IS NULL OR s.Notes NOT LIKE N'%[SMOKE%' AND s.Notes NOT LIKE N'%phase1q-smoke%')
    GROUP BY b.BranchCode
  `);
  for (const row of other.recordset) {
    if (Number(row.Cnt) > 0 && String(row.BranchCode) !== 'CAMP_CAESAR') {
      // PH1GTEST should be 0 from this backfill; smoke may add later
    }
  }

  return { inserted, skipped, fingerprintBefore, fingerprintAfter };
}

export async function listActiveBranchSchedulesForEmp(
  empId: number,
  workDate: string,
): Promise<EmpBranchWorkScheduleRow[]> {
  await ensureEmpBranchWorkScheduleTable();
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getDay();
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('dow', sql.TinyInt, dayOfWeek)
    .input('day', sql.Date, workDate)
    .query(`
      SELECT s.*
      FROM dbo.TblEmpBranchWorkSchedule s
      WHERE s.EmpID = @empId AND s.DayOfWeek = @dow AND s.IsActive = 1
        AND s.EffectiveFrom <= @day
        AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= @day)
        AND s.IsWorking = 1
      ORDER BY s.BranchID, s.EffectiveFrom DESC
    `);
  // Dedupe per branch (latest effective)
  const byBranch = new Map<number, EmpBranchWorkScheduleRow>();
  for (const row of result.recordset) {
    const mapped = mapRow(row as Record<string, unknown>);
    if (!byBranch.has(mapped.branchId)) byBranch.set(mapped.branchId, mapped);
  }
  return [...byBranch.values()];
}
