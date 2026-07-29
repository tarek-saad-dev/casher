#!/usr/bin/env npx tsx
/**
 * Recalculate MTD monthly targets for the current Cairo calendar month
 * (day 1 → today by default) for every employee with an enabled target plan.
 *
 * Processes dates ascending so day-delta = mtdTarget(D) − mtdTarget(D−1) stays correct.
 *
 * Usage:
 *   npx tsx scripts/recalc-employee-mtd-targets-current-month.ts
 *   npx tsx scripts/recalc-employee-mtd-targets-current-month.ts --dry-run
 *   npx tsx scripts/recalc-employee-mtd-targets-current-month.ts --through=2026-07-28
 *   npx tsx scripts/recalc-employee-mtd-targets-current-month.ts --month=2026-07
 *   npx tsx scripts/recalc-employee-mtd-targets-current-month.ts --branchId=1
 *   npx tsx scripts/recalc-employee-mtd-targets-current-month.ts --empId=12
 *
 * Env: loads .env then .env.local (same DB as the app).
 */
// @ts-nocheck
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad(request, parent, isMain);
};

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function cairoTodayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function monthBounds(monthKey: string): { monthStart: string; monthEnd: string } {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error(`Invalid --month=${monthKey} (expected YYYY-MM)`);
  }
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    monthStart: `${monthKey}-01`,
    monthEnd: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
  };
}

function listDatesInclusive(fromDate: string, toDate: string): string[] {
  if (fromDate > toDate) return [];
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

function money(n: number | string): string {
  return Number(n).toFixed(2);
}

async function main() {
  const dryRun = hasFlag('dry-run');
  const today = cairoTodayIso();
  const monthArg = arg('month');
  const throughArg = arg('through');
  const branchArg = arg('branchId');
  const empArg = arg('empId');

  const monthKey = monthArg ?? today.slice(0, 7);
  const { monthStart, monthEnd } = monthBounds(monthKey);

  let through = throughArg ?? (monthKey === today.slice(0, 7) ? today : monthEnd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) {
    throw new Error(`Invalid --through=${through} (expected YYYY-MM-DD)`);
  }
  if (through < monthStart) {
    throw new Error(`--through (${through}) is before month start ${monthStart}`);
  }
  if (through > monthEnd) through = monthEnd;

  const branchFilter =
    branchArg != null && branchArg !== ''
      ? Number(branchArg)
      : null;
  if (branchFilter != null && (!Number.isInteger(branchFilter) || branchFilter <= 0)) {
    throw new Error(`Invalid --branchId=${branchArg}`);
  }

  const empFilter =
    empArg != null && empArg !== ''
      ? Number(empArg)
      : null;
  if (empFilter != null && (!Number.isInteger(empFilter) || empFilter <= 0)) {
    throw new Error(`Invalid --empId=${empArg}`);
  }

  const dates = listDatesInclusive(monthStart, through);
  if (dates.length === 0) {
    console.log('No dates to process.');
    return;
  }

  const { getPool, sql } = await import('../src/lib/db');
  const { generateEmployeeDailyTargets } = await import(
    '../src/lib/payroll/employee-target/employee-daily-target-generation.service'
  );

  const db = await getPool();
  const branchReq = db
    .request()
    .input('monthStart', sql.Date, monthStart)
    .input('through', sql.Date, through);

  let branchSql = `
    SELECT DISTINCT p.BranchID
    FROM dbo.TblEmpTargetPlan p
    WHERE p.IsEnabled = 1
      AND p.EffectiveFrom <= @through
      AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @monthStart)
  `;
  if (branchFilter != null) {
    branchReq.input('branchId', sql.Int, branchFilter);
    branchSql += ` AND p.BranchID = @branchId`;
  }
  if (empFilter != null) {
    branchReq.input('empId', sql.Int, empFilter);
    branchSql += ` AND p.EmpID = @empId`;
  }
  branchSql += ` ORDER BY p.BranchID`;

  const branchRows = await branchReq.query(branchSql);
  const branchIds: number[] = branchRows.recordset.map((r: { BranchID: number }) =>
    Number(r.BranchID),
  );

  console.log('=== MTD target recalc (monthly progressive) ===');
  console.log({
    dryRun,
    month: monthKey,
    monthStart,
    through,
    days: dates.length,
    branches: branchIds,
    empId: empFilter,
  });

  if (branchIds.length === 0) {
    console.log('No enabled target plans found for this scope.');
    return;
  }

  if (dryRun) {
    for (const branchId of branchIds) {
      const planReq = db
        .request()
        .input('monthStart', sql.Date, monthStart)
        .input('through', sql.Date, through)
        .input('branchId', sql.Int, branchId);
      let planSql = `
        SELECT DISTINCT p.EmpID, e.EmpName
        FROM dbo.TblEmpTargetPlan p
        INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
        WHERE p.IsEnabled = 1
          AND p.BranchID = @branchId
          AND p.EffectiveFrom <= @through
          AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @monthStart)
      `;
      if (empFilter != null) {
        planReq.input('empId', sql.Int, empFilter);
        planSql += ` AND p.EmpID = @empId`;
      }
      planSql += ` ORDER BY e.EmpName`;
      const plans = await planReq.query(planSql);
      console.log(`\n[dry-run] branch ${branchId} — ${plans.recordset.length} employee(s):`);
      for (const row of plans.recordset) {
        console.log(`  - ${row.EmpName} (EmpID=${row.EmpID})`);
      }
    }
    console.log(`\nWould regenerate ${dates.length} day(s) × ${branchIds.length} branch(es).`);
    console.log('Re-run without --dry-run to apply.');
    return;
  }

  let totalGenerated = 0;
  let totalRecalculated = 0;
  let totalEarned = 0;
  let totalBelow = 0;
  let totalZero = 0;
  let totalTargetAmount = 0;
  let failures = 0;

  for (const workDate of dates) {
    for (const branchId of branchIds) {
      try {
        const result = await generateEmployeeDailyTargets({
          workDate,
          branchId,
          generatedByUserId: null,
          empIds: empFilter != null ? [empFilter] : null,
        });
        const t = result.totals;
        totalGenerated += t.generated;
        totalRecalculated += t.recalculated;
        totalEarned += t.earnedTarget;
        totalBelow += t.belowFirstTier;
        totalZero += t.zeroSales;
        totalTargetAmount += Number(t.totalTargetAmount);

        console.log(
          `${workDate} branch=${branchId}`
          + ` eligible=${t.eligibleEmployees}`
          + ` gen=${t.generated} recalc=${t.recalculated}`
          + ` earned=${t.earnedTarget} below=${t.belowFirstTier} zero=${t.zeroSales}`
          + ` dayDeltaTotal=${t.totalTargetAmount}`
          + ` ledger(+${t.ledgerInserted}/~${t.ledgerUpdated}/-${t.ledgerDeleted})`,
        );

        for (const emp of result.employees) {
          if (emp.displayStatus === 'earned_target' || Number(emp.mtdTargetAmount) > 0) {
            console.log(
              `    ${emp.empName}: daySales=${emp.netSalesAfterDiscount}`
              + ` mtdSales=${emp.mtdSales}`
              + ` mtdTarget=${emp.mtdTargetAmount}`
              + ` dayDelta=${emp.dayDelta}`
              + ` (${emp.displayStatus})`,
            );
          } else if (emp.displayStatus === 'below_first_tier') {
            console.log(
              `    ${emp.empName}: mtdSales=${emp.mtdSales} → below first tier (no target yet)`,
            );
          }
        }
      } catch (err) {
        failures += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`FAIL ${workDate} branch=${branchId}: ${msg}`);
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log({
    failures,
    totalGenerated,
    totalRecalculated,
    totalEarned,
    totalBelow,
    totalZero,
    sumOfDayDeltas: money(totalTargetAmount),
    note: 'sumOfDayDeltas across days ≈ last-day mtdTarget per employee (rounding aside)',
  });

  if (failures > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
