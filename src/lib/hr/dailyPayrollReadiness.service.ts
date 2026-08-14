import 'server-only';

import { getPool, sql } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { getEmpBranchWorkDayCloseState } from '@/lib/hr/empBranchWorkDayClose.service';
import { validateWorkDateYmd } from '@/lib/hr/empBranchWorkDayClose.transitions';
import {
  EmpBranchWorkDayCloseError,
  type EmpBranchWorkDayCloseState,
} from '@/lib/hr/empBranchWorkDayClose.types';
import {
  buildReadinessFromFacts,
  shortBlockerSummary,
  type ReadinessEmployeeFacts,
} from '@/lib/hr/dailyPayrollReadiness.recommend';
import type {
  DailyPayrollOpenDayItem,
  DailyPayrollOpenDaysResult,
  DailyPayrollReadinessResult,
} from '@/lib/hr/dailyPayrollReadiness.types';
import {
  validateDailyPayrollAttendance,
} from '@/lib/payroll/dailyPayrollGenerateCore';
import { loadEmpBranchDayAttendanceAggregates } from '@/lib/payroll/attendancePayrollAggregate';
import { isPayableAttendanceStatus } from '@/lib/payroll/dailyPayrollHrRules';
import { EMP_LEDGER_REASON_HOURLY_WAGE, EMP_LEDGER_REF_TYPE_DAILY_PAYROLL } from '@/lib/services/employeeLedgerDualWrite';
import { CAMP_CAESAR_BRANCH_CODE, GLEEM_BRANCH_CODE } from '@/lib/branch/smokeBranchPolicy';
import { roundMoney } from '@/lib/reportMonthUtils';

const DEFAULT_LOOKBACK_DAYS = 45;

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    // DATE columns from mssql/tedious are UTC midnight of the calendar day.
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

async function loadBranchMeta(branchId: number): Promise<{
  branchId: number;
  branchCode: string;
  branchName: string;
}> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT BranchID, BranchCode, BranchName
      FROM dbo.TblBranch
      WHERE BranchID = @branchId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new EmpBranchWorkDayCloseError('INVALID_BRANCH', 'الفرع غير موجود');
  }
  return {
    branchId: Number(row.BranchID),
    branchCode: String(row.BranchCode ?? ''),
    branchName: String(row.BranchName ?? ''),
  };
}

/**
 * Evaluate readiness for one BranchID + WorkDate.
 * Batched queries — no per-employee round trips.
 * Never mutates TblEmpBranchWorkDayClose.
 */
export async function evaluateDailyPayrollReadiness(args: {
  branchId: number;
  workDate: string;
}): Promise<DailyPayrollReadinessResult> {
  const started = Date.now();
  if (!Number.isFinite(args.branchId) || args.branchId <= 0) {
    throw new EmpBranchWorkDayCloseError('INVALID_BRANCH', 'معرف الفرع غير صالح');
  }
  const dateErr = validateWorkDateYmd(args.workDate);
  if (dateErr) {
    throw new EmpBranchWorkDayCloseError('INVALID_WORK_DATE', dateErr);
  }

  const db = await getPool();
  const dualWrite = isEmployeeLedgerDualWriteEnabled();

  const [branch, closeView, validation, aggregates] = await Promise.all([
    loadBranchMeta(args.branchId),
    getEmpBranchWorkDayCloseState(args.branchId, args.workDate),
    validateDailyPayrollAttendance(db, args.workDate, { branchId: args.branchId }),
    loadEmpBranchDayAttendanceAggregates(db, args.workDate, args.branchId),
  ]);

  // Batch: payroll + targets + plans + recalc (parallel — no N+1)
  const [payrollResult, targetResult, planResult, recalcResult] = await Promise.all([
    db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('workDate', sql.Date, args.workDate)
      .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL)
      .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_HOURLY_WAGE)
      .query(`
        SELECT
          p.ID AS PayrollID,
          p.EmpID,
          e.EmpName,
          p.ActualHours,
          p.DailyWage,
          p.Status AS PayrollStatus,
          CASE WHEN l.ID IS NULL THEN 0 ELSE 1 END AS HasLedgerCredit
        FROM dbo.TblEmpDailyPayroll p
        INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
        LEFT JOIN dbo.TblEmpLedgerEntry l
          ON l.RefType = @refType
         AND l.RefID = p.ID
         AND l.EntryReason = @entryReason
         AND l.IsVoided = 0
        WHERE p.BranchID = @branchId AND p.WorkDate = @workDate
      `),
    db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('workDate', sql.Date, args.workDate)
      .query(`
        SELECT
          t.ID AS TargetID,
          t.EmpID,
          e.EmpName,
          t.TargetAmount,
          t.Status AS TargetStatus
        FROM dbo.TblEmpDailyTarget t
        INNER JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
        WHERE t.BranchID = @branchId
          AND t.WorkDate = @workDate
          AND t.Status <> N'voided'
      `),
    db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('workDate', sql.Date, args.workDate)
      .query(`
        SELECT DISTINCT p.EmpID
        FROM dbo.TblEmpTargetPlan p
        WHERE p.BranchID = @branchId
          AND p.IsEnabled = 1
          AND p.EffectiveFrom <= @workDate
          AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @workDate)
      `),
    db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('workDate', sql.Date, args.workDate)
      .query(`
        SELECT EmpID, Status
        FROM dbo.TblEmpTargetRecalcRequest
        WHERE BranchID = @branchId AND WorkDate = @workDate
      `),
  ]);

  const payrollRows = payrollResult.recordset as Array<Record<string, unknown>>;
  const targetRows = targetResult.recordset as Array<Record<string, unknown>>;
  const planEmpIds = new Set(
    (planResult.recordset as Array<Record<string, unknown>>).map((r) => Number(r.EmpID)),
  );
  const recalcByEmp = new Map<number, string>();
  for (const r of recalcResult.recordset as Array<Record<string, unknown>>) {
    recalcByEmp.set(Number(r.EmpID), String(r.Status ?? ''));
  }

  const payrollByEmp = new Map<number, {
    payrollId: number;
    empName: string;
    actualHours: number;
    dailyWage: number;
    status: string;
    hasLedger: boolean;
  }>();
  for (const r of payrollRows) {
    const empId = Number(r.EmpID);
    payrollByEmp.set(empId, {
      payrollId: Number(r.PayrollID),
      empName: String(r.EmpName ?? ''),
      actualHours: Number(r.ActualHours ?? 0),
      dailyWage: Number(r.DailyWage ?? 0),
      status: String(r.PayrollStatus ?? ''),
      hasLedger: Number(r.HasLedgerCredit) === 1,
    });
  }

  const targetByEmp = new Map<number, {
    targetId: number;
    empName: string;
    targetAmount: number;
  }>();
  for (const r of targetRows) {
    targetByEmp.set(Number(r.EmpID), {
      targetId: Number(r.TargetID),
      empName: String(r.EmpName ?? ''),
      targetAmount: Number(r.TargetAmount ?? 0),
    });
  }

  const missingByEmp = new Map(
    validation.missing.map((m) => [m.empId, m] as const),
  );
  const excludedByEmp = new Map(
    validation.excluded.map((m) => [m.empId, m] as const),
  );

  const empIds = new Set<number>();
  for (const id of aggregates.keys()) empIds.add(id);
  for (const id of payrollByEmp.keys()) empIds.add(id);
  for (const id of targetByEmp.keys()) empIds.add(id);
  for (const id of missingByEmp.keys()) empIds.add(id);
  for (const id of planEmpIds) {
    // Only include plan holders who have branch activity (attendance or payroll)
    if (aggregates.has(id) || payrollByEmp.has(id)) empIds.add(id);
  }

  // Resolve names for attendance-only employees
  const nameByEmp = new Map<number, string>();
  for (const [empId, p] of payrollByEmp) nameByEmp.set(empId, p.empName);
  for (const [empId, t] of targetByEmp) {
    if (!nameByEmp.has(empId)) nameByEmp.set(empId, t.empName);
  }
  for (const m of validation.missing) nameByEmp.set(m.empId, m.empName);
  for (const m of validation.excluded) nameByEmp.set(m.empId, m.empName);

  const missingNames = [...empIds].filter((id) => !nameByEmp.has(id));
  if (missingNames.length > 0) {
    const req = db.request();
    const ph = missingNames.map((id, i) => {
      req.input(`n${i}`, sql.Int, id);
      return `@n${i}`;
    });
    const nameResult = await req.query(`
      SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID IN (${ph.join(',')})
    `);
    for (const r of nameResult.recordset as Array<Record<string, unknown>>) {
      nameByEmp.set(Number(r.EmpID), String(r.EmpName ?? ''));
    }
  }

  const facts: ReadinessEmployeeFacts[] = [];
  for (const empId of empIds) {
    const agg = aggregates.get(empId);
    const payroll = payrollByEmp.get(empId);
    const target = targetByEmp.get(empId);
    const missing = missingByEmp.get(empId);
    const excluded = excludedByEmp.get(empId);

    const hasAttendance = agg != null;
    const hasOpenSession = Boolean(agg?.hasOpenSession);
    const hasAnyCheckIn = Boolean(agg?.hasAnyCheckIn);
    const netMinutes = agg?.netMinutes ?? 0;
    const payable =
      agg != null &&
      agg.primaryStatus != null &&
      isPayableAttendanceStatus(agg.primaryStatus);

    const expectsPayroll =
      (payable && !hasOpenSession) ||
      Boolean(payroll) ||
      Boolean(missing); // hard validation missing implies they were expected

    const payrollGenerated = Boolean(
      payroll &&
        ['Generated', 'Earned', 'PostedToCashMove', 'PendingCheckout'].includes(
          payroll.status,
        ),
    );

    const expectsTarget = planEmpIds.has(empId) && expectsPayroll && !hasOpenSession;
    const targetGenerated = Boolean(target);

    let payrollLedgerPresent: boolean | null = null;
    if (dualWrite && payrollGenerated && payroll && payroll.dailyWage > 0) {
      payrollLedgerPresent = payroll.hasLedger;
    }

    const recalc = recalcByEmp.get(empId);
    let targetSyncStatus: ReadinessEmployeeFacts['targetSyncStatus'] = 'none';
    if (recalc === 'pending') targetSyncStatus = 'pending';
    else if (recalc === 'processing') targetSyncStatus = 'processing';
    else if (recalc === 'failed') targetSyncStatus = 'failed';
    else if (targetGenerated) targetSyncStatus = 'up_to_date';

    facts.push({
      empId,
      empName: nameByEmp.get(empId) ?? `#${empId}`,
      hasAttendance,
      hasOpenSession,
      hasAnyCheckIn,
      netMinutes,
      expectsPayroll,
      payrollGenerated,
      payrollId: payroll?.payrollId ?? null,
      dailyWage: payroll?.dailyWage ?? 0,
      expectsTarget,
      targetGenerated,
      targetId: target?.targetId ?? null,
      targetAmount: target?.targetAmount ?? 0,
      payrollLedgerPresent,
      targetSyncStatus,
      validationReason: missing?.reason ?? excluded?.reason ?? null,
      validationIsHardMissing: Boolean(missing),
    });
  }

  facts.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));

  const totalHours = roundMoney(
    [...payrollByEmp.values()].reduce((s, p) => s + p.actualHours, 0),
  );
  const totalWage = roundMoney(
    [...payrollByEmp.values()].reduce((s, p) => s + p.dailyWage, 0),
  );
  const totalTargetAmount = roundMoney(
    [...targetByEmp.values()].reduce((s, t) => s + t.targetAmount, 0),
  );

  return buildReadinessFromFacts({
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    workDate: args.workDate,
    persistedState: closeView.state,
    isVirtualOpen: closeView.isVirtualOpen,
    closeAudit: closeView.row
      ? {
          closedAt: closeView.row.closedAt,
          closedByUserId: closeView.row.closedByUserId,
          reopenedAt: closeView.row.reopenedAt,
          reopenedByUserId: closeView.row.reopenedByUserId,
          reopenReason: closeView.row.reopenReason,
        }
      : null,
    facts,
    payrollRowCount: payrollRows.length,
    targetRowCount: targetRows.length,
    totalHours,
    totalWage,
    totalTargetAmount,
    elapsedMs: Date.now() - started,
  });
}

/**
 * Discover unresolved BranchID+WorkDate for GLEEM + CAMP_CAESAR.
 * CLOSED persisted states are excluded. Never mutates close table.
 *
 * Date window:
 * - Prefer fromWorkDate/toWorkDate when provided
 * - Else lookbackDays from today (default 45, max 90)
 */
export async function listDailyPayrollOpenDays(args?: {
  lookbackDays?: number;
  fromWorkDate?: string;
  toWorkDate?: string;
  branchIds?: number[];
}): Promise<DailyPayrollOpenDaysResult> {
  const started = Date.now();
  const fromErr = args?.fromWorkDate ? validateWorkDateYmd(args.fromWorkDate) : null;
  if (fromErr) {
    throw new EmpBranchWorkDayCloseError('INVALID_WORK_DATE', fromErr);
  }
  const toErr = args?.toWorkDate ? validateWorkDateYmd(args.toWorkDate) : null;
  if (toErr) {
    throw new EmpBranchWorkDayCloseError('INVALID_WORK_DATE', toErr);
  }

  const lookbackDays = Math.min(Math.max(args?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 1), 90);
  const fromWorkDate = args?.fromWorkDate ?? null;
  const toWorkDate = args?.toWorkDate ?? null;
  const db = await getPool();

  const branchesResult = await db.request().query(`
    SELECT BranchID, BranchCode, BranchName
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'${GLEEM_BRANCH_CODE}', N'${CAMP_CAESAR_BRANCH_CODE}')
      AND IsActive = 1
    ORDER BY CASE BranchCode WHEN N'${GLEEM_BRANCH_CODE}' THEN 0 ELSE 1 END
  `);
  let branches = (branchesResult.recordset as Array<Record<string, unknown>>).map((r) => ({
    branchId: Number(r.BranchID),
    branchCode: String(r.BranchCode ?? ''),
    branchName: String(r.BranchName ?? ''),
  }));
  if (args?.branchIds?.length) {
    const allow = new Set(args.branchIds);
    branches = branches.filter((b) => allow.has(b.branchId));
  }
  if (branches.length === 0) {
    return { items: [], lookbackDays, fromWorkDate, toWorkDate, elapsedMs: Date.now() - started };
  }

  const idList = branches.map((b) => b.branchId).join(',');
  const req = db.request();
  let dateFilterSql: string;
  if (fromWorkDate) {
    req.input('fromWorkDate', sql.Date, fromWorkDate);
    if (toWorkDate) {
      req.input('toWorkDate', sql.Date, toWorkDate);
      dateFilterSql = 'WorkDate >= @fromWorkDate AND WorkDate <= @toWorkDate';
    } else {
      dateFilterSql = 'WorkDate >= @fromWorkDate';
    }
  } else {
    req.input('lookbackDays', sql.Int, lookbackDays);
    dateFilterSql =
      'WorkDate >= DATEADD(DAY, -@lookbackDays, CAST(SYSUTCDATETIME() AS DATE))';
  }

  const candidatesResult = await req.query(`
      SELECT DISTINCT BranchID, WorkDate
      FROM (
        SELECT BranchID, WorkDate
        FROM dbo.TblEmpAttendance
        WHERE BranchID IN (${idList})
          AND ${dateFilterSql}
        UNION
        SELECT BranchID, WorkDate
        FROM dbo.TblEmpDailyPayroll
        WHERE BranchID IN (${idList})
          AND ${dateFilterSql}
      ) x
      ORDER BY WorkDate ASC, BranchID ASC
    `);

  const candidates = (candidatesResult.recordset as Array<Record<string, unknown>>).map(
    (r) => ({
      branchId: Number(r.BranchID),
      workDate: formatDateValue(r.WorkDate),
    }),
  );

  // Load persisted close states for candidates in one query
  const closeMap = new Map<string, EmpBranchWorkDayCloseState>();
  if (candidates.length > 0) {
    const closeReq = db.request();
    let closeDateSql: string;
    if (fromWorkDate) {
      closeReq.input('fromWorkDate', sql.Date, fromWorkDate);
      if (toWorkDate) {
        closeReq.input('toWorkDate', sql.Date, toWorkDate);
        closeDateSql = 'WorkDate >= @fromWorkDate AND WorkDate <= @toWorkDate';
      } else {
        closeDateSql = 'WorkDate >= @fromWorkDate';
      }
    } else {
      closeReq.input('lookbackDays', sql.Int, lookbackDays);
      closeDateSql =
        'WorkDate >= DATEADD(DAY, -@lookbackDays, CAST(SYSUTCDATETIME() AS DATE))';
    }
    const closeResult = await closeReq.query(`
      SELECT BranchID, WorkDate, State
      FROM dbo.TblEmpBranchWorkDayClose
      WHERE BranchID IN (${idList})
        AND ${closeDateSql}
    `);
    for (const r of closeResult.recordset as Array<Record<string, unknown>>) {
      const key = `${Number(r.BranchID)}|${formatDateValue(r.WorkDate)}`;
      closeMap.set(key, String(r.State) as EmpBranchWorkDayCloseState);
    }
  }

  const unresolved = candidates.filter((c) => {
    const state = closeMap.get(`${c.branchId}|${c.workDate}`);
    return state !== 'CLOSED';
  });

  // Evaluate in small parallel chunks to bound DB load
  const items: DailyPayrollOpenDayItem[] = [];
  const CHUNK = 4;
  for (let i = 0; i < unresolved.length; i += CHUNK) {
    const slice = unresolved.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((c) =>
        evaluateDailyPayrollReadiness({ branchId: c.branchId, workDate: c.workDate }),
      ),
    );
    for (const r of results) {
      // Skip fully idle OPEN with no activity (candidates should have activity, but be safe)
      if (!r.summary.hasActivity && r.recommendedState === 'OPEN' && r.persistedState === 'OPEN') {
        continue;
      }
      items.push({
        branchId: r.branchId,
        branchCode: r.branchCode,
        branchName: r.branchName,
        workDate: r.workDate,
        persistedState: r.persistedState,
        recommendedState: r.recommendedState,
        readyToClose: r.readyToClose,
        blockerCount: r.summary.blockerCount,
        readyEmployeeCount: r.summary.readyEmployeeCount,
        employeeCount: r.summary.employeeCount,
        shortBlockerSummary: shortBlockerSummary(r.blockers),
      });
    }
  }

  // Sort: oldest first, then blockers before ready, then branch
  items.sort((a, b) => {
    if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
    const rank = (s: EmpBranchWorkDayCloseState, ready: boolean, blockers: number) => {
      if (s === 'REOPENED') return 0;
      if (blockers > 0 || s === 'NEEDS_REVIEW') return 1;
      if (ready || s === 'READY_TO_CLOSE') return 2;
      return 3;
    };
    const ra = rank(a.recommendedState, a.readyToClose, a.blockerCount);
    const rb = rank(b.recommendedState, b.readyToClose, b.blockerCount);
    if (ra !== rb) return ra - rb;
    return a.branchId - b.branchId;
  });

  return {
    items,
    lookbackDays,
    fromWorkDate,
    toWorkDate,
    elapsedMs: Date.now() - started,
  };
}
