#!/usr/bin/env npx tsx
/**
 * Create CAMP_CAESAR target plan for Omar (EmpID 25) mirroring GLEEM plan #163,
 * then regenerate MTD daily targets for Sep 2026 through today.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED || 'true';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

const EMP_ID = 25;
const BRANCH_ID = 3; // CAMP_CAESAR
const EFFECTIVE_FROM = '2026-09-01';

const TIERS = [
  { inputStartAmount: 10000, ratePercent: 10 },
  { inputStartAmount: 20000, ratePercent: 20 },
  { inputStartAmount: 30000, ratePercent: 30 },
  { inputStartAmount: 40000, ratePercent: 40 },
  { inputStartAmount: 50000, ratePercent: 50 },
  { inputStartAmount: 60000, ratePercent: 60 },
  { inputStartAmount: 70000, ratePercent: 70 },
];

function listDatesInclusive(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromDate}T12:00:00`);
  const end = new Date(`${toDate}T12:00:00`);
  while (d.getTime() <= end.getTime()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { saveEmployeeTargetPlan } = await import(
    '../src/lib/payroll/employee-target/employee-target-plan.service'
  );
  const { generateEmployeeDailyTargets } = await import(
    '../src/lib/payroll/employee-target/employee-daily-target-generation.service'
  );

  const db = await getPool();
  const today = getCairoBusinessDate();
  console.log(JSON.stringify({ empId: EMP_ID, branchId: BRANCH_ID, effectiveFrom: EFFECTIVE_FROM, today }, null, 2));

  // Idempotent: skip create if enabled plan already covers Sep on CC
  const existing = await db.request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .input('from', sql.Date, EFFECTIVE_FROM)
    .input('to', sql.Date, today)
    .query(`
      SELECT p.ID, p.IsEnabled,
        CONVERT(varchar(10), p.EffectiveFrom, 120) AS EffectiveFrom,
        CONVERT(varchar(10), p.EffectiveTo, 120) AS EffectiveTo
      FROM dbo.TblEmpTargetPlan p
      WHERE p.EmpID = @empId AND p.BranchID = @branchId
        AND p.IsEnabled = 1
        AND p.EffectiveFrom <= @to
        AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @from)
      ORDER BY p.EffectiveFrom DESC, p.ID DESC
    `);

  let planId: number;
  if (existing.recordset.length > 0) {
    planId = Number(existing.recordset[0].ID);
    console.log('=== Existing enabled CC plan ===', existing.recordset[0]);
  } else {
    console.log('=== Creating CC target plan (mirror GLEEM #163) ===');
    const saved = await saveEmployeeTargetPlan(
      EMP_ID,
      {
        isEnabled: true,
        conversionDays: 26,
        effectiveFrom: EFFECTIVE_FROM,
        notes: 'CC plan mirrored from GLEEM #163 — Omar Sep 2026 ops fix',
        tiers: TIERS,
      } as never,
      null,
      BRANCH_ID,
    );
    planId = Number(saved.id);
    console.log('Created plan', JSON.stringify(saved, null, 2));
  }

  const dates = listDatesInclusive(EFFECTIVE_FROM, today);
  console.log(`\n=== Regenerating targets ${EFFECTIVE_FROM} → ${today} (${dates.length} days) ===`);

  let totalGenerated = 0;
  let totalRecalculated = 0;
  let sumDayDeltas = 0;
  let lastMtdTarget = '0';
  let lastMtdSales = '0';
  let failures = 0;

  for (const workDate of dates) {
    try {
      const result = await generateEmployeeDailyTargets({
        workDate,
        branchId: BRANCH_ID,
        generatedByUserId: null,
        empIds: [EMP_ID],
      });
      const t = result.totals;
      totalGenerated += t.generated;
      totalRecalculated += t.recalculated;
      sumDayDeltas += Number(t.totalTargetAmount);

      const emp = result.employees.find((e) => e.empId === EMP_ID);
      if (emp) {
        lastMtdTarget = emp.mtdTargetAmount;
        lastMtdSales = emp.mtdSales;
        if (
          emp.displayStatus === 'earned_target' ||
          Number(emp.dayDelta) > 0 ||
          Number(emp.mtdTargetAmount) > 0
        ) {
          console.log(
            `${workDate}: daySales=${emp.netSalesAfterDiscount}` +
              ` mtdSales=${emp.mtdSales}` +
              ` mtdTarget=${emp.mtdTargetAmount}` +
              ` dayDelta=${emp.dayDelta}` +
              ` (${emp.displayStatus})` +
              ` ledger(+${t.ledgerInserted}/~${t.ledgerUpdated}/-${t.ledgerDeleted})`,
          );
        } else {
          console.log(
            `${workDate}: mtdSales=${emp.mtdSales} dayDelta=${emp.dayDelta} (${emp.displayStatus})`,
          );
        }
      } else {
        console.log(`${workDate}: no employee row (eligible=${t.eligibleEmployees})`);
      }
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${workDate}:`, err instanceof Error ? err.message : err);
    }
  }

  const verify = await db.request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .input('from', sql.Date, EFFECTIVE_FROM)
    .input('to', sql.Date, today)
    .query(`
      SELECT
        COUNT(*) AS days,
        CAST(SUM(TargetAmount) AS float) AS sumDayTarget,
        CAST(SUM(NetSalesAfterDiscount) AS float) AS sumDaySales
      FROM dbo.TblEmpDailyTarget
      WHERE EmpID = @empId AND BranchID = @branchId
        AND WorkDate >= @from AND WorkDate <= @to
        AND Status <> N'voided'
    `);

  const ledger = await db.request()
    .input('empId', sql.Int, EMP_ID)
    .input('branchId', sql.Int, BRANCH_ID)
    .input('from', sql.Date, EFFECTIVE_FROM)
    .input('to', sql.Date, today)
    .query(`
      SELECT COUNT(*) AS cnt, CAST(SUM(Amount) AS float) AS total
      FROM dbo.TblEmpLedgerEntry
      WHERE EmpID = @empId AND BranchID = @branchId
        AND EntryDate >= @from AND EntryDate <= @to
        AND EntryReason = N'target' AND ISNULL(IsVoided,0)=0
    `);

  console.log('\n=== DONE ===');
  console.log(JSON.stringify({
    planId,
    failures,
    totalGenerated,
    totalRecalculated,
    lastMtdSales,
    lastMtdTarget,
    sumOfDayDeltas: sumDayDeltas.toFixed(2),
    storedDailyTargets: verify.recordset[0],
    targetLedger: ledger.recordset[0],
  }, null, 2));

  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
