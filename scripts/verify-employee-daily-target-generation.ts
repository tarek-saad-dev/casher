#!/usr/bin/env npx tsx
/**
 * Read-only / generate verification for Phase 3 daily targets.
 * Does NOT touch ledger or CashMove intentionally in app code —
 * this script only counts those tables before/after generation.
 */
// @ts-nocheck
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import sql from 'mssql';

// Allow importing Next server-only modules from a CLI script.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad(request, parent, isMain);
};

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function main() {
  const workDate = process.argv[2] || new Date().toISOString().slice(0, 10);

  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  });

  const before = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget) AS dailyTarget,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry) AS ledger,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS cashMove,
      (SELECT COUNT(*) FROM dbo.TblEmpTargetPlan WHERE IsEnabled = 1) AS enabledPlans
  `);
  console.log('counts_before', before.recordset[0]);
  console.log('workDate', workDate);

  // Import app generation (uses same pool env via getPool)
  await pool.close();

  const { generateEmployeeDailyTargets } = await import(
    '../src/lib/payroll/employee-target/employee-daily-target-generation.service'
  );
  const { getEmployeesNetServiceSalesByDate } = await import(
    '../src/lib/payroll/employee-target/employee-target-sales-service'
  );
  const { calculateDailyTarget } = await import(
    '../src/lib/payroll/employee-target/calculate-daily-target'
  );
  const { listEnabledPlansCoveringDate, listTiersForPlanIds, listDailyTargetsByWorkDate } =
    await import('../src/lib/payroll/employee-target/employee-daily-target.repository');
  const { resolveUniqueEffectivePlans } = await import(
    '../src/lib/payroll/employee-target/effective-plan-resolve'
  );

  const gen1 = await generateEmployeeDailyTargets({
    workDate,
    generatedByUserId: null,
  });
  console.log('generate_1', gen1.totals);

  const gen2 = await generateEmployeeDailyTargets({
    workDate,
    generatedByUserId: null,
  });
  console.log('generate_2_recalc', gen2.totals);

  const plans = await listEnabledPlansCoveringDate(workDate);
  let planByEmp: Map<number, (typeof plans)[0]>;
  try {
    planByEmp = resolveUniqueEffectivePlans(plans);
  } catch (e) {
    console.error('plan_conflict', e);
    process.exit(2);
  }
  const tiers = await listTiersForPlanIds([...planByEmp.values()].map((p) => p.planId));
  const sales = await getEmployeesNetServiceSalesByDate(workDate, [...planByEmp.keys()]);
  const stored = await listDailyTargetsByWorkDate(workDate);
  const salesMap = new Map(sales.map((s) => [s.empId, s]));
  const storedMap = new Map(stored.map((s) => [s.empId, s]));

  let fail = 0;
  for (const [empId, plan] of planByEmp) {
    const empTiers = tiers
      .filter((t) => t.targetPlanId === plan.planId)
      .map((t) => ({
        sortOrder: t.sortOrder,
        inputStartAmount: t.inputStartAmount,
        dailyStartAmount: t.dailyStartAmount,
        ratePercent: t.ratePercent,
      }));
    const net = salesMap.get(empId)?.netSalesAfterDiscount ?? 0;
    const calc = calculateDailyTarget(net, empTiers);
    const row = storedMap.get(empId);
    const salesDiff = Math.abs((row?.netSalesAfterDiscount ?? -1) - calc.netSalesAfterDiscount);
    const targetDiff = Math.abs((row?.targetAmount ?? -1) - calc.targetAmount);
    const planOk = row?.targetPlanId === plan.planId;
    const pass = !!row && salesDiff < 0.001 && targetDiff < 0.001 && planOk;
    if (!pass) fail += 1;
    console.log({
      empId,
      empName: plan.empName,
      sharedSales: net,
      storedSales: row?.netSalesAfterDiscount ?? null,
      calcTarget: calc.targetAmount,
      storedTarget: row?.targetAmount ?? null,
      expectedPlanId: plan.planId,
      storedPlanId: row?.targetPlanId ?? null,
      pass: pass ? 'PASS' : 'FAIL',
    });
  }

  const pool2 = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
  });

  const after = await pool2.request().input('d', sql.Date, workDate).query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget) AS dailyTarget,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyTarget WHERE WorkDate = @d) AS dailyTargetDay,
      (SELECT COUNT(*) FROM (
         SELECT EmpID FROM dbo.TblEmpDailyTarget WHERE WorkDate = @d GROUP BY EmpID HAVING COUNT(*) > 1
       ) x) AS dupDay,
      (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry) AS ledger,
      (SELECT COUNT(*) FROM dbo.TblCashMove) AS cashMove
  `);
  console.log('counts_after', after.recordset[0]);
  console.log('parity_failures', fail);
  console.log('generated_vs_recalc', {
    g1: gen1.totals,
    g2: gen2.totals,
  });

  const b = before.recordset[0] as { ledger: number; cashMove: number };
  const a = after.recordset[0] as { ledger: number; cashMove: number; dupDay: number };
  if (a.ledger !== b.ledger || a.cashMove !== b.cashMove) {
    console.error('UNEXPECTED write to ledger or cashMove');
    process.exit(3);
  }
  if (a.dupDay > 0) {
    console.error('Duplicate EmpID+WorkDate found');
    process.exit(4);
  }
  if (fail > 0) process.exit(5);

  console.log('VERIFICATION OK');
  await pool2.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
