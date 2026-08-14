#!/usr/bin/env npx tsx
/**
 * Phase 5 — Final Daily Payroll Closing Verification (GLEEM + CAMP_CAESAR).
 *
 * Safe live proof:
 *   - picks one historical WorkDate per branch with payroll activity
 *   - snapshots attendance → payroll → target → ledger BEFORE
 *   - close GLEEM only (Camp isolation)
 *   - prove PAYROLL_DAY_CLOSED blocks regenerate
 *   - prove close changes zero financial values
 *   - close Camp independently
 *   - reopen one branch → regenerate → READY → close again
 *   - open-days CLOSED/REOPENED behavior
 *
 * Does NOT touch post-to-cash, payouts, advances, or delete ledger history.
 *
 *   npx tsx scripts/verify-phase5-daily-payroll-closing.ts
 *   npx tsx scripts/verify-phase5-daily-payroll-closing.ts --gleem-date=YYYY-MM-DD --camp-date=YYYY-MM-DD
 *   npx tsx scripts/verify-phase5-daily-payroll-closing.ts --dry-run
 */
// @ts-nocheck
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad(request, parent, isMain);
};

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const DRY_RUN = process.argv.includes('--dry-run');
const LOOKBACK = 45;
let ACTOR_USER_ID = Number(process.env.PHASE5_ACTOR_USER_ID || 0);

type Snapshot = {
  attendanceRows: number;
  attendancePresent: number;
  checkInCount: number;
  checkOutCount: number;
  payrollRows: number;
  payrollWage: number;
  payrollHours: number;
  targetRows: number;
  targetAmount: number;
  wageLedgerCredit: number;
  wageLedgerRows: number;
  targetLedgerCredit: number;
  targetLedgerRows: number;
  balanceSample: Array<{ empId: number; balance: number }>;
  closeState: string;
};

function ymd(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function buildConfig(): sql.config {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
    requestTimeout: 180000,
  };
}

async function snapshot(
  pool: sql.ConnectionPool,
  branchId: number,
  workDate: string,
): Promise<Snapshot> {
  const att = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT
        COUNT(*) AS AttendanceRows,
        SUM(CASE WHEN Status IN (N'Present', N'Late', N'EarlyLeave') THEN 1 ELSE 0 END) AS Presentish,
        SUM(CASE WHEN CheckInTime IS NOT NULL THEN 1 ELSE 0 END) AS CheckInCount,
        SUM(CASE WHEN CheckOutTime IS NOT NULL THEN 1 ELSE 0 END) AS CheckOutCount
      FROM dbo.TblEmpAttendance
      WHERE BranchID = @branchId AND WorkDate = @workDate
    `);

  const pay = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT
        COUNT(*) AS PayrollRows,
        ISNULL(SUM(CAST(DailyWage AS FLOAT)), 0) AS PayrollWage,
        ISNULL(SUM(CAST(ActualHours AS FLOAT)), 0) AS PayrollHours
      FROM dbo.TblEmpDailyPayroll
      WHERE BranchID = @branchId AND WorkDate = @workDate
    `);

  const tgt = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT
        COUNT(*) AS TargetRows,
        ISNULL(SUM(CAST(TargetAmount AS FLOAT)), 0) AS TargetAmount
      FROM dbo.TblEmpDailyTarget
      WHERE BranchID = @branchId AND WorkDate = @workDate
    `);

  const wageLed = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT
        COUNT(*) AS RowsCnt,
        ISNULL(SUM(CASE WHEN EntryDirection = N'credit' THEN CAST(Amount AS FLOAT) ELSE 0 END), 0) AS Credit
      FROM dbo.TblEmpLedgerEntry
      WHERE BranchID = @branchId
        AND EntryDate = @workDate
        AND EntryReason = N'hourly_wage'
        AND (IsVoided = 0 OR IsVoided IS NULL)
    `);

  const tgtLed = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT
        COUNT(*) AS RowsCnt,
        ISNULL(SUM(CASE WHEN EntryDirection = N'credit' THEN CAST(Amount AS FLOAT) ELSE 0 END), 0) AS Credit
      FROM dbo.TblEmpLedgerEntry
      WHERE BranchID = @branchId
        AND EntryDate = @workDate
        AND EntryReason = N'target'
        AND (IsVoided = 0 OR IsVoided IS NULL)
    `);

  const bal = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 5
        EmpID,
        ISNULL(SUM(CASE WHEN EntryDirection = N'credit' AND (IsVoided = 0 OR IsVoided IS NULL) THEN CAST(Amount AS FLOAT) ELSE 0 END), 0)
        - ISNULL(SUM(CASE WHEN EntryDirection = N'debit' AND (IsVoided = 0 OR IsVoided IS NULL) THEN CAST(Amount AS FLOAT) ELSE 0 END), 0) AS Balance
      FROM dbo.TblEmpLedgerEntry
      WHERE BranchID = @branchId
      GROUP BY EmpID
      ORDER BY EmpID
    `);

  const close = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1 State
      FROM dbo.TblEmpBranchWorkDayClose
      WHERE BranchID = @branchId AND WorkDate = @workDate
    `);

  const a = att.recordset[0] || {};
  const p = pay.recordset[0] || {};
  const t = tgt.recordset[0] || {};
  const w = wageLed.recordset[0] || {};
  const tl = tgtLed.recordset[0] || {};

  return {
    attendanceRows: Number(a.AttendanceRows || 0),
    attendancePresent: Number(a.Presentish || 0),
    checkInCount: Number(a.CheckInCount || 0),
    checkOutCount: Number(a.CheckOutCount || 0),
    payrollRows: Number(p.PayrollRows || 0),
    payrollWage: round2(Number(p.PayrollWage || 0)),
    payrollHours: round2(Number(p.PayrollHours || 0)),
    targetRows: Number(t.TargetRows || 0),
    targetAmount: round2(Number(t.TargetAmount || 0)),
    wageLedgerCredit: round2(Number(w.Credit || 0)),
    wageLedgerRows: Number(w.RowsCnt || 0),
    targetLedgerCredit: round2(Number(tl.Credit || 0)),
    targetLedgerRows: Number(tl.RowsCnt || 0),
    balanceSample: (bal.recordset || []).map((r: any) => ({
      empId: Number(r.EmpID),
      balance: round2(Number(r.Balance || 0)),
    })),
    closeState: close.recordset[0] ? String(close.recordset[0].State) : 'OPEN(virtual)',
  };
}

function diffFinancial(before: Snapshot, after: Snapshot): string[] {
  const keys: Array<keyof Snapshot> = [
    'attendanceRows',
    'attendancePresent',
    'checkInCount',
    'checkOutCount',
    'payrollRows',
    'payrollWage',
    'payrollHours',
    'targetRows',
    'targetAmount',
    'wageLedgerCredit',
    'wageLedgerRows',
    'targetLedgerCredit',
    'targetLedgerRows',
  ];
  const diffs: string[] = [];
  for (const k of keys) {
    if (before[k] !== after[k]) diffs.push(`${k}: ${before[k]} → ${after[k]}`);
  }
  const bMap = new Map(before.balanceSample.map((x) => [x.empId, x.balance]));
  for (const row of after.balanceSample) {
    const prev = bMap.get(row.empId);
    if (prev !== undefined && prev !== row.balance) {
      diffs.push(`balance emp ${row.empId}: ${prev} → ${row.balance}`);
    }
  }
  return diffs;
}

async function findCandidateDay(
  pool: sql.ConnectionPool,
  branchId: number,
  forced?: string,
): Promise<string | null> {
  if (forced) return forced;

  // Prefer days with payroll + targets + closed attendance sessions, not already CLOSED.
  const r = await pool
    .request()
    .input('branchId', sql.Int, branchId)
    .input('lookback', sql.Int, LOOKBACK)
    .query(`
      SELECT TOP 15
        p.WorkDate,
        COUNT(DISTINCT p.ID) AS PayrollRows,
        COUNT(DISTINCT t.ID) AS TargetRows,
        SUM(CASE WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NULL THEN 1 ELSE 0 END) AS OpenSessions,
        MAX(c.State) AS CloseState
      FROM dbo.TblEmpDailyPayroll p
      LEFT JOIN dbo.TblEmpDailyTarget t
        ON t.BranchID = p.BranchID AND t.WorkDate = p.WorkDate AND t.EmpID = p.EmpID
      LEFT JOIN dbo.TblEmpAttendance a
        ON a.BranchID = p.BranchID AND a.WorkDate = p.WorkDate AND a.EmpID = p.EmpID
      LEFT JOIN dbo.TblEmpBranchWorkDayClose c
        ON c.BranchID = p.BranchID AND c.WorkDate = p.WorkDate
      WHERE p.BranchID = @branchId
        AND p.WorkDate >= DATEADD(DAY, -@lookback, CAST(SYSUTCDATETIME() AS DATE))
        AND p.WorkDate < CAST(SYSUTCDATETIME() AS DATE)
      GROUP BY p.WorkDate
      HAVING COUNT(DISTINCT p.ID) > 0
      ORDER BY p.WorkDate DESC
    `);

  const rows = r.recordset || [];
  // Prefer not CLOSED, with targets, no open sessions
  const preferred = rows.find(
    (row: any) =>
      String(row.CloseState || '') !== 'CLOSED' &&
      Number(row.TargetRows || 0) > 0 &&
      Number(row.OpenSessions || 0) === 0,
  );
  if (preferred) return ymd(preferred.WorkDate);

  const anyOpen = rows.find((row: any) => String(row.CloseState || '') !== 'CLOSED');
  if (anyOpen) return ymd(anyOpen.WorkDate);

  // Allow already CLOSED so we can reopen → prove cycle (still historical)
  if (rows[0]) return ymd(rows[0].WorkDate);
  return null;
}

function printSnap(label: string, s: Snapshot) {
  console.log(`  [${label}] state=${s.closeState}`);
  console.log(
    `    att rows=${s.attendanceRows} in=${s.checkInCount} out=${s.checkOutCount} | payroll rows=${s.payrollRows} wage=${s.payrollWage} hrs=${s.payrollHours}`,
  );
  console.log(
    `    target rows=${s.targetRows} amt=${s.targetAmount} | wageLed credit=${s.wageLedgerCredit} (${s.wageLedgerRows}) | tgtLed credit=${s.targetLedgerCredit} (${s.targetLedgerRows})`,
  );
}

async function main() {
  const failures: string[] = [];
  const notes: string[] = [];
  const report: Record<string, unknown> = {
    dryRun: DRY_RUN,
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME,
  };

  console.log('=== Phase 5 Daily Payroll Closing Verification ===');
  console.log(`dryRun=${DRY_RUN}`);

  const pool = await sql.connect(buildConfig());
  console.log(`connected database=${(pool as any).config?.database || report.database}`);

  if (!Number.isFinite(ACTOR_USER_ID) || ACTOR_USER_ID <= 0) {
    const u = await pool.request().query(`
      SELECT TOP 1 UserID
      FROM dbo.TblUser
      WHERE ISNULL(isDeleted, 0) = 0 AND UserLevel = N'admin'
      ORDER BY UserID
    `);
    ACTOR_USER_ID = Number(u.recordset[0]?.UserID || 0);
  }
  if (!ACTOR_USER_ID) throw new Error('No admin UserID found for close/reopen actor');
  console.log(`actorUserId=${ACTOR_USER_ID}`);
  report.actorUserId = ACTOR_USER_ID;

  const branches = await pool.request().query(`
    SELECT BranchID, BranchCode, BranchName
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'GLEEM', N'CAMP_CAESAR') AND IsActive = 1
    ORDER BY CASE BranchCode WHEN N'GLEEM' THEN 0 ELSE 1 END
  `);
  const gleem = branches.recordset.find((b: any) => b.BranchCode === 'GLEEM');
  const camp = branches.recordset.find((b: any) => b.BranchCode === 'CAMP_CAESAR');
  if (!gleem || !camp) {
    throw new Error('GLEEM or CAMP_CAESAR active branch missing');
  }
  const gleemId = Number(gleem.BranchID);
  const campId = Number(camp.BranchID);
  console.log(`branches: GLEEM=#${gleemId} CAMP=#${campId}`);

  const gleemDate = await findCandidateDay(pool, gleemId, arg('gleem-date'));
  const campDate = await findCandidateDay(pool, campId, arg('camp-date'));
  if (!gleemDate || !campDate) {
    throw new Error(`No candidate WorkDate found gleem=${gleemDate} camp=${campDate}`);
  }
  console.log(`selected WorkDates: GLEEM=${gleemDate} CAMP=${campDate}`);
  report.gleemDate = gleemDate;
  report.campDate = campDate;

  // Prefer same calendar date when both have activity (stronger isolation proof).
  // If forced dates differ, still OK.
  if (gleemDate === campDate) {
    notes.push(`Same calendar WorkDate ${gleemDate} used for isolation proof`);
  } else {
    notes.push(`Different WorkDates (GLEEM ${gleemDate}, Camp ${campDate}) — still BranchID-scoped`);
  }

  // Import app services after DB connect (server-only stubbed).
  const { evaluateDailyPayrollReadiness, listDailyPayrollOpenDays } = await import(
    '../src/lib/hr/dailyPayrollReadiness.service'
  );
  const { closeEmpBranchWorkDay, reopenEmpBranchWorkDay } = await import(
    '../src/lib/hr/dailyPayrollClose.service'
  );
  const { assertEmpBranchWorkDayMutable, getEmpBranchWorkDayCloseState } = await import(
    '../src/lib/hr/empBranchWorkDayClose.service'
  );
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '../src/lib/services/employeeLedgerDualWrite'
  );
  const { generateEmployeeDailyTargets } = await import(
    '../src/lib/payroll/employee-target/employee-daily-target-generation.service'
  );

  async function ensureReady(branchId: number, workDate: string, code: string) {
    let readiness = await evaluateDailyPayrollReadiness({ branchId, workDate });
    console.log(
      `  readiness ${code} ${workDate}: persisted=${readiness.persistedState} recommended=${readiness.recommendedState} ready=${readiness.readyToClose} blockers=${readiness.summary.blockerCount}`,
    );
    if (readiness.persistedState === 'CLOSED') {
      console.log(`  ${code} already CLOSED — will reopen later in cycle if selected`);
      return readiness;
    }
    if (readiness.readyToClose) return readiness;

    // Safe unlock path: regenerate payroll + targets (no attendance mutation).
    if (DRY_RUN) {
      notes.push(`${code}: not READY (blockers=${readiness.summary.blockerCount}) — dry-run skip generate`);
      return readiness;
    }
    try {
      console.log(`  attempting safe generate for ${code} ${workDate}…`);
      await runDailyPayrollGenerateWithOptionalLedger(workDate, { branchId });
    } catch (e: any) {
      notes.push(`${code} payroll generate: ${e?.message || e}`);
    }
    try {
      await generateEmployeeDailyTargets({
        workDate,
        branchId,
        generatedByUserId: ACTOR_USER_ID,
      });
    } catch (e: any) {
      notes.push(`${code} target generate: ${e?.message || e}`);
    }
    readiness = await evaluateDailyPayrollReadiness({ branchId, workDate });
    console.log(
      `  after generate ${code}: recommended=${readiness.recommendedState} ready=${readiness.readyToClose} blockers=${readiness.summary.blockerCount}`,
    );
    if (!readiness.readyToClose) {
      const codes = [...new Set(readiness.blockers.map((b: any) => b.code))].join(',');
      failures.push(`${code} ${workDate} still not READY_TO_CLOSE (${codes || 'no codes'})`);
    }
    return readiness;
  }

  // ── 1) BEFORE ────────────────────────────────────────────────────────────
  const gleemBefore = await snapshot(pool, gleemId, gleemDate);
  const campBefore = await snapshot(pool, campId, campDate);
  printSnap('GLEEM BEFORE', gleemBefore);
  printSnap('CAMP BEFORE', campBefore);

  // Cross-branch employee scope sample: same EmpID if exists on both branches for date
  const cross = await pool
    .request()
    .input('gleemId', sql.Int, gleemId)
    .input('campId', sql.Int, campId)
    .input('gleemDate', sql.Date, gleemDate)
    .input('campDate', sql.Date, campDate)
    .query(`
      SELECT g.EmpID,
             g.DailyWage AS GleemWage,
             c.DailyWage AS CampWage
      FROM dbo.TblEmpDailyPayroll g
      INNER JOIN dbo.TblEmpDailyPayroll c
        ON c.EmpID = g.EmpID AND c.BranchID = @campId AND c.WorkDate = @campDate
      WHERE g.BranchID = @gleemId AND g.WorkDate = @gleemDate
    `);
  report.crossBranchEmpCount = cross.recordset.length;
  if (cross.recordset.length > 0) {
    notes.push(
      `Cross-branch employees on selected days: ${cross.recordset.length} (rows remain BranchID-scoped)`,
    );
  }

  // Overnight / stored WorkDate proof (source + readiness date validation)
  const readinessSrc = await import('fs').then((fs) =>
    fs.readFileSync(
      path.join(__dirname, '..', 'src/lib/hr/dailyPayrollReadiness.service.ts'),
      'utf8',
    ),
  );
  if (/BUSINESS_DAY_CUTOFF|getBusinessDateStr|5 AM/i.test(readinessSrc)) {
    failures.push('Readiness invents cutoff instead of stored WorkDate');
  } else {
    notes.push('Overnight/readiness uses stored WorkDate (no cutoff invent)');
  }

  // ── 2) Reach READY ───────────────────────────────────────────────────────
  console.log('\n--- Reach READY_TO_CLOSE ---');
  let gleemReady = await ensureReady(gleemId, gleemDate, 'GLEEM');
  let campReady = await ensureReady(campId, campDate, 'CAMP');

  // If already CLOSED, reopen first so we can prove close cycle cleanly
  async function ensureNotClosedForCloseTest(branchId: number, workDate: string, code: string) {
    const view = await getEmpBranchWorkDayCloseState(branchId, workDate);
    if (view.state !== 'CLOSED') return;
    if (DRY_RUN) {
      notes.push(`${code} already CLOSED — dry-run cannot reopen`);
      return;
    }
    console.log(`  ${code} was CLOSED — reopening for clean close proof…`);
    await reopenEmpBranchWorkDay({
      branchId,
      workDate,
      actorUserId: ACTOR_USER_ID,
      reopenReason: 'Phase5 pretest reopen to prove close cycle',
    });
  }
  await ensureNotClosedForCloseTest(gleemId, gleemDate, 'GLEEM');
  await ensureNotClosedForCloseTest(campId, campDate, 'CAMP');
  gleemReady = await ensureReady(gleemId, gleemDate, 'GLEEM');
  campReady = await ensureReady(campId, campDate, 'CAMP');

  const gleemPreClose = await snapshot(pool, gleemId, gleemDate);
  const campPreClose = await snapshot(pool, campId, campDate);

  // ── 3) Close GLEEM only ──────────────────────────────────────────────────
  console.log('\n--- Close GLEEM only ---');
  if (!DRY_RUN && gleemReady.readyToClose) {
    const closed = await closeEmpBranchWorkDay({
      branchId: gleemId,
      workDate: gleemDate,
      actorUserId: ACTOR_USER_ID,
    });
    console.log(
      `  GLEEM closed state=${closed.view.state} by=${closed.view.row?.closedByUserId} at=${closed.view.row?.closedAt}`,
    );
    report.gleemClose = {
      state: closed.view.state,
      closedByUserId: closed.view.row?.closedByUserId,
      closedAt: closed.view.row?.closedAt,
    };
  } else if (!gleemReady.readyToClose) {
    failures.push('GLEEM not READY_TO_CLOSE — cannot close');
  } else {
    notes.push('dry-run: skipped GLEEM close');
  }

  const campAfterGleemClose = await getEmpBranchWorkDayCloseState(campId, campDate);
  const gleemAfterClose = await getEmpBranchWorkDayCloseState(gleemId, gleemDate);
  if (!DRY_RUN) {
    if (gleemAfterClose.state !== 'CLOSED') failures.push('GLEEM not CLOSED after close');
    if (campAfterGleemClose.state === 'CLOSED' && campDate === gleemDate) {
      failures.push('Camp became CLOSED when only GLEEM was closed (isolation break)');
    } else {
      notes.push(
        `Isolation OK: after GLEEM close, Camp ${campDate} state=${campAfterGleemClose.state}`,
      );
    }
  }

  // Mutation block proof
  console.log('\n--- PAYROLL_DAY_CLOSED mutation guards (GLEEM) ---');
  if (!DRY_RUN && gleemAfterClose.state === 'CLOSED') {
    try {
      await assertEmpBranchWorkDayMutable(gleemId, gleemDate);
      failures.push('assertEmpBranchWorkDayMutable did not throw on CLOSED GLEEM');
    } catch (e: any) {
      if (e?.code === 'PAYROLL_DAY_CLOSED') {
        notes.push('assertEmpBranchWorkDayMutable → PAYROLL_DAY_CLOSED OK');
      } else {
        failures.push(`unexpected assert error: ${e?.code || e?.message}`);
      }
    }
    try {
      await runDailyPayrollGenerateWithOptionalLedger(gleemDate, { branchId: gleemId });
      failures.push('payroll generate did not block on CLOSED GLEEM');
    } catch (e: any) {
      if (e?.code === 'PAYROLL_DAY_CLOSED') notes.push('payroll generate blocked PAYROLL_DAY_CLOSED');
      else failures.push(`payroll generate unexpected: ${e?.code || e?.message}`);
    }
    try {
      await generateEmployeeDailyTargets({
        workDate: gleemDate,
        branchId: gleemId,
        generatedByUserId: ACTOR_USER_ID,
      });
      failures.push('target generate did not block on CLOSED GLEEM');
    } catch (e: any) {
      if (e?.code === 'PAYROLL_DAY_CLOSED') notes.push('target generate blocked PAYROLL_DAY_CLOSED');
      else failures.push(`target generate unexpected: ${e?.code || e?.message}`);
    }
  }

  // ── 4) Close must change zero financials ─────────────────────────────────
  const gleemAfterCloseSnap = await snapshot(pool, gleemId, gleemDate);
  const closeDiffs = diffFinancial(gleemPreClose, gleemAfterCloseSnap);
  printSnap('GLEEM AFTER CLOSE', gleemAfterCloseSnap);
  if (closeDiffs.length === 0) {
    notes.push('GLEEM close → 0 accounting difference');
    report.gleemCloseFinancialDiff = [];
  } else {
    failures.push(`GLEEM close changed finances: ${closeDiffs.join('; ')}`);
    report.gleemCloseFinancialDiff = closeDiffs;
  }

  // Camp financials unchanged by GLEEM close
  const campMid = await snapshot(pool, campId, campDate);
  const campIsoDiff = diffFinancial(campPreClose, campMid);
  if (campIsoDiff.length === 0) notes.push('Camp financials unchanged by GLEEM close');
  else failures.push(`Camp finances changed after GLEEM close: ${campIsoDiff.join('; ')}`);

  // ── 5) Close Camp independently ──────────────────────────────────────────
  console.log('\n--- Close Camp independently ---');
  if (!DRY_RUN && campReady.readyToClose && campAfterGleemClose.state !== 'CLOSED') {
    const campClosed = await closeEmpBranchWorkDay({
      branchId: campId,
      workDate: campDate,
      actorUserId: ACTOR_USER_ID,
    });
    console.log(`  CAMP closed state=${campClosed.view.state}`);
    report.campClose = {
      state: campClosed.view.state,
      closedByUserId: campClosed.view.row?.closedByUserId,
      closedAt: campClosed.view.row?.closedAt,
    };
    const campAfter = await snapshot(pool, campId, campDate);
    const campCloseDiff = diffFinancial(campMid, campAfter);
    if (campCloseDiff.length === 0) notes.push('Camp close → 0 accounting difference');
    else failures.push(`Camp close changed finances: ${campCloseDiff.join('; ')}`);
  } else if (!campReady.readyToClose) {
    failures.push('Camp not READY_TO_CLOSE — cannot close independently');
  } else {
    notes.push('dry-run or already closed: skipped Camp close mutation');
  }

  // open-days: CLOSED should disappear
  console.log('\n--- open-days after closes ---');
  const openAfterClose = await listDailyPayrollOpenDays({ lookbackDays: LOOKBACK });
  const gleemOpen = openAfterClose.items.find(
    (i: any) => i.branchId === gleemId && i.workDate === gleemDate,
  );
  const campOpen = openAfterClose.items.find(
    (i: any) => i.branchId === campId && i.workDate === campDate,
  );
  if (!DRY_RUN) {
    if (gleemOpen) failures.push('CLOSED GLEEM day still listed in open-days');
    else notes.push('open-days: CLOSED GLEEM removed');
    if (campOpen && (await getEmpBranchWorkDayCloseState(campId, campDate)).state === 'CLOSED') {
      failures.push('CLOSED Camp day still listed in open-days');
    } else if (!campOpen) {
      notes.push('open-days: CLOSED Camp removed (or never listed)');
    }
  }

  // ── 6) Reopen one branch (prefer GLEEM) ───────────────────────────────────
  console.log('\n--- Reopen GLEEM + regenerate + reclose ---');
  let reopenResult: any = null;
  if (!DRY_RUN && (await getEmpBranchWorkDayCloseState(gleemId, gleemDate)).state === 'CLOSED') {
    reopenResult = await reopenEmpBranchWorkDay({
      branchId: gleemId,
      workDate: gleemDate,
      actorUserId: ACTOR_USER_ID,
      reopenReason: 'Phase5 verification reopen — controlled test reason',
    });
    console.log(
      `  reopened by=${reopenResult.row?.reopenedByUserId} at=${reopenResult.row?.reopenedAt} reason=${reopenResult.row?.reopenReason}`,
    );
    if (reopenResult.row?.reopenedByUserId !== ACTOR_USER_ID) {
      failures.push('reopen audit user mismatch');
    }
    if (!reopenResult.row?.reopenedAt) failures.push('reopen missing ReopenedAt');
    if (reopenResult.row?.reopenReason !== 'Phase5 verification reopen — controlled test reason') {
      failures.push('reopen reason mismatch');
    }
    report.reopen = {
      state: reopenResult.state,
      reopenedByUserId: reopenResult.row?.reopenedByUserId,
      reopenedAt: reopenResult.row?.reopenedAt,
      reopenReason: reopenResult.row?.reopenReason,
    };

    const openAfterReopen = await listDailyPayrollOpenDays({ lookbackDays: LOOKBACK });
    const gleemReopenedListed = openAfterReopen.items.find(
      (i: any) => i.branchId === gleemId && i.workDate === gleemDate,
    );
    if (!gleemReopenedListed) {
      // May be missing if no activity flag — but REOPENED with activity should appear
      const rdy = await evaluateDailyPayrollReadiness({ branchId: gleemId, workDate: gleemDate });
      if (rdy.summary.hasActivity) {
        failures.push('REOPENED GLEEM with activity missing from open-days');
      } else {
        notes.push('REOPENED day not in open-days (no activity) — unexpected for payroll day');
      }
    } else {
      notes.push(`open-days: REOPENED GLEEM restored (persisted=${gleemReopenedListed.persistedState})`);
    }

    const beforeRegen = await snapshot(pool, gleemId, gleemDate);
    // Controlled correction = regenerate (no attendance formula change)
    await runDailyPayrollGenerateWithOptionalLedger(gleemDate, { branchId: gleemId });
    await generateEmployeeDailyTargets({
      workDate: gleemDate,
      branchId: gleemId,
      generatedByUserId: ACTOR_USER_ID,
    });
    const afterRegen = await snapshot(pool, gleemId, gleemDate);
    const regenDiff = diffFinancial(beforeRegen, afterRegen);
    report.regenDiff = regenDiff;
    if (regenDiff.length === 0) {
      notes.push('Regenerate after reopen produced 0 financial delta (idempotent)');
    } else {
      notes.push(`Regenerate deltas (allowed after reopen): ${regenDiff.join('; ')}`);
    }

    const readyAgain = await evaluateDailyPayrollReadiness({
      branchId: gleemId,
      workDate: gleemDate,
    });
    console.log(
      `  after reopen+regen: persisted=${readyAgain.persistedState} recommended=${readyAgain.recommendedState} ready=${readyAgain.readyToClose}`,
    );
    if (!readyAgain.readyToClose) {
      failures.push('GLEEM not READY after reopen+regen');
    } else {
      const preReclose = await snapshot(pool, gleemId, gleemDate);
      const reclosed = await closeEmpBranchWorkDay({
        branchId: gleemId,
        workDate: gleemDate,
        actorUserId: ACTOR_USER_ID,
      });
      const postReclose = await snapshot(pool, gleemId, gleemDate);
      const recloseDiff = diffFinancial(preReclose, postReclose);
      report.reclose = { state: reclosed.view.state, financialDiff: recloseDiff };
      if (recloseDiff.length) failures.push(`reclose changed finances: ${recloseDiff.join('; ')}`);
      else notes.push('Reclose → 0 accounting difference');

      const openFinal = await listDailyPayrollOpenDays({ lookbackDays: LOOKBACK });
      if (openFinal.items.some((i: any) => i.branchId === gleemId && i.workDate === gleemDate)) {
        failures.push('re-CLOSED GLEEM still in open-days');
      } else {
        notes.push('open-days: re-CLOSED GLEEM removed again');
      }
    }
  } else {
    notes.push('Skipped reopen/reclose cycle (dry-run or GLEEM not CLOSED)');
  }

  // Final Camp still independent
  const campFinal = await getEmpBranchWorkDayCloseState(campId, campDate);
  report.campFinalState = campFinal.state;
  notes.push(`Camp final state=${campFinal.state} (independent of GLEEM reopen/reclose)`);

  await pool.close();

  console.log('\n=== NOTES ===');
  for (const n of notes) console.log(`  · ${n}`);
  console.log('\n=== FAILURES ===');
  if (failures.length === 0) console.log('  (none)');
  else for (const f of failures) console.log(`  ✗ ${f}`);

  const verdict = failures.length === 0 ? 'PRODUCTION GO' : 'PRODUCTION NO-GO';
  report.notes = notes;
  report.failures = failures;
  report.verdict = verdict;
  console.log(`\nVERDICT: ${verdict}`);
  console.log(JSON.stringify(report, null, 2));

  if (failures.length) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
