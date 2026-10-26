/**
 * Explicitly guarded end-to-end rehearsal for Ziad's Oct-2026 branch salary
 * correction. Only writes into a disposable restored production snapshot.
 *
 * Invoke from a Next-compatible server-only Node/tsx environment, with
 * PAYROLL_E2E_ALLOW_WRITE=isolated-clone and NODE_OPTIONS=--conditions=react-server.
 * NEVER use against last132 or last132_agent.
 */
import { loadEnvConfig } from '@next/env';

async function main() {
  const expectedDatabase = 'last132_payroll_rehearsal';
  if (process.env.PAYROLL_E2E_ALLOW_WRITE !== 'isolated-clone') {
    throw new Error('STOP: explicitly set PAYROLL_E2E_ALLOW_WRITE=isolated-clone');
  }

  loadEnvConfig(process.env.PAYROLL_E2E_ENV_DIR || process.cwd(), false);
  // Must be set before dynamically importing @/lib/db (config is module-scoped).
  process.env.LOCAL_DB_NAME = expectedDatabase;
  process.env.LOCAL_DB_SERVER = '127.0.0.1';
  process.env.LOCAL_DB_PORT = '1433';
  process.env.HAWAI_DB_CLASS = 'local';
  process.env.BOOKING_V2_FORCE_LOCAL_DB = 'true';

  const { getPool, closePool, sql } = await import('@/lib/db');
  const { previewRetroVip } = await import('@/lib/payroll/retroactiveAgreementPreview');
  const { applyRetroVip } = await import('@/lib/payroll/retroactiveAgreementApply');
  const { getCairoBusinessDate } = await import('@/lib/businessDate');

  const pool = await getPool();
  try {
    const db = await pool.request().query('SELECT DB_NAME() AS Name, @@SERVERNAME AS ServerName');
    const connected = String(db.recordset[0]?.Name || '');
    if (connected !== expectedDatabase) {
      throw new Error('STOP: wrong SQL database: ' + connected);
    }
    if (getCairoBusinessDate().slice(0, 7) !== '2026-10') {
      throw new Error('STOP: this rehearsal is specific to October 2026');
    }
    const empId = 12;
    const row = await pool.request().input('empId', sql.Int, empId).query(
      "SELECT EmpID, EmpName, CAST(TenantId AS NVARCHAR(40)) AS TenantId, PayrollScope FROM dbo.TblEmp WHERE EmpID=@empId"
    );
    const employee = row.recordset[0];
    if (!employee || !String(employee.EmpName).includes('زياد') ||
        String(employee.PayrollScope) !== 'global') {
      throw new Error('STOP: employee 12 not present or already changed');
    }

    const branches = await pool.request().query(
      "SELECT BranchID,BranchCode FROM dbo.TblBranch WHERE BranchCode IN (N'GLEEM',N'CAMP_CAESAR')"
    );
    const ids = new Map<string, number>(
      branches.recordset.map((r: {BranchCode:string;BranchID:number}) =>
        [String(r.BranchCode), Number(r.BranchID)])
    );
    const gleem = ids.get('GLEEM');
    const camp = ids.get('CAMP_CAESAR');
    if (!gleem || !camp) throw new Error('STOP: branch references are missing');

    // Count all cash movements and preserve each non-wage ledger category.
    const ledgerSnapshot = async () => {
      const result = await pool.request().input('empId', sql.Int, empId)
        .query([
          'SELECT BranchID,EntryReason,EntryDirection,IsVoided,',
          'COUNT_BIG(*) AS EntryCount,CAST(SUM(Amount) AS DECIMAL(18,2)) AS Total',
          'FROM dbo.TblEmpLedgerEntry WHERE EmpID=@empId',
          "AND EntryReason NOT IN (N'hourly_wage',N'monthly_salary')",
          'GROUP BY BranchID,EntryReason,EntryDirection,IsVoided',
          'ORDER BY BranchID,EntryReason,EntryDirection,IsVoided',
        ].join(' '));
      return JSON.stringify(result.recordset);
    };
    const cashSnapshot = async () => {
      const result = await pool.request().query(
        'SELECT COUNT_BIG(*) AS EntryCount, CAST(SUM(CAST(ISNULL(GrandTolal,0) AS DECIMAL(18,2))) AS DECIMAL(18,2)) AS Total FROM dbo.TblCashMove'
      );
      return JSON.stringify(result.recordset);
    };
    const oldLedger = await ledgerSnapshot();
    const oldCash = await cashSnapshot();
    const user = await pool.request().query('SELECT TOP 1 UserID FROM dbo.TblUser ORDER BY UserID');
    const userId = Number(user.recordset[0]?.UserID);
    if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('STOP: audit user unavailable');

    const input = {
      effectiveFrom: '2026-10-01',
      reason: 'اختبار تسوية زياد على نسخة معزولة من الإنتاج قبل التنفيذ الفعلي',
      branches: [
        { branchId: gleem, enabled: true, monthlySalary: 4000 },
        { branchId: camp, enabled: true, monthlySalary: 6000 },
      ],
    };
    const preview = await previewRetroVip({ empId, tenantId:String(employee.TenantId), input });
    console.log('IMPACT PREVIEW:', JSON.stringify({
      dailyCount:preview.dailyCount, oldWages:preview.previousLedgerCredits,
      newSalary:preview.proposedMonthlyAmount, difference:preview.difference,
      blockers:preview.blockers,
    }, null, 2));
    if (preview.blockers.length) {
      throw new Error('STOP: financial preview blockers: ' + preview.blockers.join(' | '));
    }
    if (preview.proposedMonthlyAmount !== 10000) throw new Error('STOP: salary amount mismatch');
    if (preview.dailyCount < 1 || preview.previousLedgerCredits <= 0) {
      throw new Error('STOP: cloned October wages were not found');
    }

    const { randomUUID } = await import('node:crypto');
    const applyInput = {
      ...input, expectedFingerprint:preview.fingerprint,
      requestKey:randomUUID(),
    };
    const applied = await applyRetroVip({
      empId, tenantId:String(employee.TenantId), userId, input:applyInput,
    });
    if (!applied.success || applied.alreadyApplied ||
        applied.supersededDailyRows !== preview.dailyCount ||
        applied.voidedWageLedgerEntries !== preview.dailyCount ||
        applied.newSalaryTotal !== 10000) {
      throw new Error('STOP: apply result did not match the approved preview');
    }

    const verify = await pool.request().input('empId',sql.Int,empId)
      .query([
        'SELECT',
        "SUM(CASE WHEN EntryReason=N'hourly_wage' AND IsVoided=0 THEN 1 ELSE 0 END) AS ActiveWageRows,",
        "SUM(CASE WHEN EntryReason=N'monthly_salary' AND IsVoided=0 THEN 1 ELSE 0 END) AS SalaryRows,",
        "SUM(CASE WHEN EntryReason=N'monthly_salary' AND IsVoided=0 THEN Amount ELSE 0 END) AS SalaryAmount",
        'FROM dbo.TblEmpLedgerEntry',
        "WHERE EmpID=@empId AND PayrollMonth=N'2026-10'",
      ].join(' '));
    const check = verify.recordset[0];
    if (Number(check.ActiveWageRows||0) !== 0 ||
        Number(check.SalaryRows||0) !== 2 ||
        Number(check.SalaryAmount||0) !== 10000) {
      throw new Error('STOP: reconciliation failed ' + JSON.stringify(check));
    }
    const repeated = await applyRetroVip({
      empId, tenantId:String(employee.TenantId), userId, input:applyInput,
    });
    if (!repeated.alreadyApplied || repeated.revisionId !== applied.revisionId) {
      throw new Error('STOP: duplicate request was not idempotent');
    }
    if (await ledgerSnapshot() !== oldLedger) {
      throw new Error('STOP: a non-wage employee ledger entry was changed');
    }
    if (await cashSnapshot() !== oldCash) {
      throw new Error('STOP: cash movements changed unexpectedly');
    }
    console.log('PAYROLL E2E REHEARSAL: SUCCESS');
    console.log(JSON.stringify({
      database:connected, empId, appliedRevision:applied.revisionId,
      oldWages:preview.previousLedgerCredits, newSalary:10000,
      difference:preview.difference, dailyRows:preview.dailyCount,
      nonWageLedgerUnchanged:true, cashUnchanged:true, idempotent:true,
    }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch(error => {
  console.error('PAYROLL E2E REHEARSAL FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
