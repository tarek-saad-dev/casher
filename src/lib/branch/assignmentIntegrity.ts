/**
 * Phase 1G — employee branch assignment integrity (no redesign).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { branchNow } from './repository';

export type AssignmentIntegrityIssue = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  empId?: number;
  branchId?: number;
  assignmentId?: number;
};

export type AssignmentIntegrityReport = {
  checkedAt: string;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: AssignmentIntegrityIssue[];
};

function periodsOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom <= bEnd && bFrom <= aEnd;
}

function ymd(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Audit TblEmpBranchAssignment for readiness before second-branch ops.
 */
export async function auditEmployeeAssignmentIntegrity(
  at: Date = branchNow(),
): Promise<AssignmentIntegrityReport> {
  const day = at.toISOString().slice(0, 10);
  const db = await getPool();
  const issues: AssignmentIntegrityIssue[] = [];

  const orphanBranch = await db.request().query(`
    SELECT ea.ID, ea.EmpID, ea.BranchID
    FROM dbo.TblEmpBranchAssignment ea
    LEFT JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
    WHERE b.BranchID IS NULL
  `);
  for (const row of orphanBranch.recordset) {
    issues.push({
      code: 'ASSIGNMENT_ORPHAN_BRANCH',
      severity: 'error',
      message: `Assignment ${row.ID} references missing BranchID ${row.BranchID}`,
      empId: Number(row.EmpID),
      branchId: Number(row.BranchID),
      assignmentId: Number(row.ID),
    });
  }

  const inactiveBranch = await db.request().query(`
    SELECT ea.ID, ea.EmpID, ea.BranchID, b.BranchCode
    FROM dbo.TblEmpBranchAssignment ea
    INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
    WHERE ea.IsActive = 1 AND b.IsActive = 0
  `);
  for (const row of inactiveBranch.recordset) {
    issues.push({
      code: 'ASSIGNMENT_INACTIVE_BRANCH',
      severity: 'warning',
      message: `Active assignment ${row.ID} on inactive branch ${row.BranchCode}`,
      empId: Number(row.EmpID),
      branchId: Number(row.BranchID),
      assignmentId: Number(row.ID),
    });
  }

  const badDates = await db.request().query(`
    SELECT ea.ID, ea.EmpID, ea.BranchID, ea.EffectiveFrom, ea.EffectiveTo
    FROM dbo.TblEmpBranchAssignment ea
    WHERE ea.EffectiveTo IS NOT NULL AND ea.EffectiveTo < ea.EffectiveFrom
  `);
  for (const row of badDates.recordset) {
    issues.push({
      code: 'ASSIGNMENT_INVALID_DATES',
      severity: 'error',
      message: `Assignment ${row.ID} has EffectiveTo before EffectiveFrom`,
      empId: Number(row.EmpID),
      branchId: Number(row.BranchID),
      assignmentId: Number(row.ID),
    });
  }

  const nowhere = await db.request().input('day', sql.Date, day).query(`
    SELECT e.EmpID, e.EmpName
    FROM dbo.TblEmp e
    WHERE ISNULL(e.isActive, 1) = 1
      AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.TblEmpBranchAssignment ea
        INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
        WHERE ea.EmpID = e.EmpID
          AND ea.IsActive = 1
          AND b.IsActive = 1
          AND ea.EffectiveFrom <= @day
          AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
      )
  `);
  for (const row of nowhere.recordset) {
    issues.push({
      code: 'EMP_ASSIGNED_NOWHERE',
      severity: 'warning',
      message: `Active barber EmpID ${row.EmpID} has no effective branch assignment on ${day}`,
      empId: Number(row.EmpID),
    });
  }

  const activeRows = await db.request().input('day', sql.Date, day).query(`
    SELECT ea.ID, ea.EmpID, ea.BranchID, ea.EffectiveFrom, ea.EffectiveTo,
           ea.IsHomeBranch, ea.CanReceiveBookings
    FROM dbo.TblEmpBranchAssignment ea
    WHERE ea.IsActive = 1
      AND ea.EffectiveFrom <= @day
      AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
    ORDER BY ea.EmpID, ea.BranchID, ea.ID
  `);

  const byEmpBranch = new Map<string, (typeof activeRows.recordset)[number][]>();
  for (const row of activeRows.recordset) {
    const key = `${row.EmpID}:${row.BranchID}`;
    const list = byEmpBranch.get(key) ?? [];
    list.push(row);
    byEmpBranch.set(key, list);
  }
  for (const [, list] of byEmpBranch) {
    if (list.length > 1) {
      issues.push({
        code: 'DUPLICATE_ACTIVE_ASSIGNMENT',
        severity: 'error',
        message: `EmpID ${list[0].EmpID} has ${list.length} concurrent active assignments on BranchID ${list[0].BranchID}`,
        empId: Number(list[0].EmpID),
        branchId: Number(list[0].BranchID),
      });
    }
  }

  // Overlapping date ranges for same emp+branch among all active (incl future) rows
  const allActive = await db.request().query(`
    SELECT ea.ID, ea.EmpID, ea.BranchID, ea.EffectiveFrom, ea.EffectiveTo
    FROM dbo.TblEmpBranchAssignment ea
    WHERE ea.IsActive = 1
    ORDER BY ea.EmpID, ea.BranchID, ea.EffectiveFrom, ea.ID
  `);
  const grouped = new Map<string, (typeof allActive.recordset)[number][]>();
  for (const row of allActive.recordset) {
    const key = `${row.EmpID}:${row.BranchID}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  for (const [, list] of grouped) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (
          periodsOverlap(
            ymd(a.EffectiveFrom),
            a.EffectiveTo == null ? null : ymd(a.EffectiveTo),
            ymd(b.EffectiveFrom),
            b.EffectiveTo == null ? null : ymd(b.EffectiveTo),
          )
        ) {
          issues.push({
            code: 'OVERLAPPING_ASSIGNMENT_RANGES',
            severity: 'error',
            message: `Overlapping assignments ${a.ID} and ${b.ID} for EmpID ${a.EmpID} BranchID ${a.BranchID}`,
            empId: Number(a.EmpID),
            branchId: Number(a.BranchID),
            assignmentId: Number(a.ID),
          });
        }
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  return {
    checkedAt: at.toISOString(),
    issueCount: issues.length,
    errorCount,
    warningCount,
    issues,
  };
}

/**
 * Ensure (or create) an active assignment for an employee at a branch.
 * Does not redesign assignment rules — minimal insert for bootstrap/smoke.
 */
export async function ensureEmployeeBranchAssignment(args: {
  empId: number;
  branchId: number;
  effectiveFrom: string;
  canReceiveBookings?: boolean;
  isHomeBranch?: boolean;
}): Promise<{ created: boolean; assignmentId: number }> {
  const db = await getPool();
  const existing = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('day', sql.Date, args.effectiveFrom)
    .query(`
      SELECT TOP 1 ID
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      ORDER BY ID
    `);
  if (existing.recordset[0]) {
    return { created: false, assignmentId: Number(existing.recordset[0].ID) };
  }

  const result = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('from', sql.Date, args.effectiveFrom)
    .input('canBook', sql.Bit, args.canReceiveBookings !== false ? 1 : 0)
    .input('isHome', sql.Bit, args.isHomeBranch ? 1 : 0)
    .query(`
      INSERT INTO dbo.TblEmpBranchAssignment (
        EmpID, BranchID, IsHomeBranch, CanReceiveBookings, IsActive, EffectiveFrom, EffectiveTo
      )
      OUTPUT INSERTED.ID
      VALUES (@empId, @branchId, @isHome, @canBook, 1, @from, NULL)
    `);
  return { created: true, assignmentId: Number(result.recordset[0].ID) };
}
