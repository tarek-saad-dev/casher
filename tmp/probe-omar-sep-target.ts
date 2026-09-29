#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const db = await getPool();
  const today = getCairoBusinessDate();
  const monthFrom = '2026-09-01';
  const monthTo = today;

  console.log(JSON.stringify({ today, monthFrom, monthTo }, null, 2));

  const emps = await db.request().query(`
    SELECT EmpID, EmpName, isActive, IsPayrollEnabled, HourlyRate, ManualHourlyRate
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%عمر%' AND ISNULL(isActive,1)=1
    ORDER BY EmpID
  `);
  console.log('\n=== EMPS ===');
  console.log(JSON.stringify(emps.recordset, null, 2));

  for (const e of emps.recordset as Array<{ EmpID: number; EmpName: string }>) {
    const empId = e.EmpID;
    console.log(`\n\n########## ${empId} ${e.EmpName} ##########`);

    const plans = await db.request().input('id', sql.Int, empId).query(`
      SELECT p.ID AS PlanID, p.EmpID, p.BranchID, b.BranchCode, p.IsEnabled, p.InputBasis,
        p.ConversionDays,
        CONVERT(varchar(10), p.EffectiveFrom, 120) AS EffectiveFrom,
        CONVERT(varchar(10), p.EffectiveTo, 120) AS EffectiveTo,
        p.CreatedAt
      FROM dbo.TblEmpTargetPlan p
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      WHERE p.EmpID = @id
      ORDER BY p.BranchID, p.EffectiveFrom
    `);
    console.log('\n=== TARGET PLANS ===');
    console.log(JSON.stringify(plans.recordset, null, 2));

    for (const plan of plans.recordset as Array<{ PlanID: number }>) {
      const tiers = await db.request().input('pid', sql.Int, plan.PlanID).query(`
        SELECT ID, TargetPlanID, InputStartAmount, DailyStartAmount, RatePercent, SortOrder
        FROM dbo.TblEmpTargetTier
        WHERE TargetPlanID = @pid
        ORDER BY SortOrder, InputStartAmount
      `);
      console.log(`\n=== TIERS plan=${plan.PlanID} ===`);
      console.log(JSON.stringify(tiers.recordset, null, 2));
    }

    const att = await db.request()
      .input('id', sql.Int, empId)
      .input('from', sql.Date, monthFrom)
      .input('to', sql.Date, monthTo)
      .query(`
      SELECT CONVERT(varchar(10), a.WorkDate, 120) AS WorkDate, a.BranchID, b.BranchCode,
        CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
        CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
        a.Status, a.ID AS AttendanceID
      FROM dbo.TblEmpAttendance a
      JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
      WHERE a.EmpID = @id AND a.WorkDate >= @from AND a.WorkDate <= @to
      ORDER BY a.WorkDate, a.BranchID
    `);
    console.log('\n=== ATTENDANCE SEP ===');
    console.log(JSON.stringify(att.recordset, null, 2));

    const pay = await db.request()
      .input('id', sql.Int, empId)
      .input('from', sql.Date, monthFrom)
      .input('to', sql.Date, monthTo)
      .query(`
      SELECT CONVERT(varchar(10), p.WorkDate, 120) AS WorkDate, p.BranchID, b.BranchCode,
        p.Status, CAST(p.DailyWage AS float) AS DailyWage,
        CAST(p.ActualHours AS float) AS Hours,
        p.ID AS PayrollID
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      WHERE p.EmpID = @id AND p.WorkDate >= @from AND p.WorkDate <= @to
      ORDER BY p.WorkDate, p.BranchID
    `);
    console.log('\n=== PAYROLL SEP ===');
    console.log(JSON.stringify(pay.recordset, null, 2));

    const targets = await db.request()
      .input('id', sql.Int, empId)
      .input('from', sql.Date, monthFrom)
      .input('to', sql.Date, monthTo)
      .query(`
      SELECT CONVERT(varchar(10), t.WorkDate, 120) AS WorkDate, t.BranchID, b.BranchCode,
        t.TargetPlanID, CAST(t.NetSalesAfterDiscount AS float) AS NetSales,
        CAST(t.TargetAmount AS float) AS TargetAmount,
        t.Status, t.CalculationVersion,
        LEFT(t.CalculationBreakdownJson, 800) AS BreakdownHead,
        t.ID AS TargetID,
        CONVERT(varchar(19), t.GeneratedAt, 120) AS GeneratedAt,
        CONVERT(varchar(19), t.UpdatedAt, 120) AS UpdatedAt
      FROM dbo.TblEmpDailyTarget t
      JOIN dbo.TblBranch b ON b.BranchID = t.BranchID
      WHERE t.EmpID = @id AND t.WorkDate >= @from AND t.WorkDate <= @to
      ORDER BY t.WorkDate, t.BranchID
    `);
    console.log('\n=== DAILY TARGETS SEP ===');
    console.log(JSON.stringify(targets.recordset, null, 2));

    const led = await db.request()
      .input('id', sql.Int, empId)
      .input('from', sql.Date, monthFrom)
      .input('to', sql.Date, monthTo)
      .query(`
      SELECT CONVERT(varchar(10), l.EntryDate, 120) AS EntryDate, l.BranchID, b.BranchCode,
        l.EntryReason, CAST(l.Amount AS float) AS Amount, l.RefID, l.IsVoided, l.Notes
      FROM dbo.TblEmpLedgerEntry l
      JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
      WHERE l.EmpID = @id AND l.EntryDate >= @from AND l.EntryDate <= @to
        AND l.EntryReason IN (N'hourly_wage', N'target', N'daily_target', N'target_bonus')
        AND ISNULL(l.IsVoided,0)=0
      ORDER BY l.EntryDate, l.EntryReason, l.BranchID
    `);
    console.log('\n=== LEDGER hourly/target SEP ===');
    console.log(JSON.stringify(led.recordset, null, 2));

    const ledSum = await db.request()
      .input('id', sql.Int, empId)
      .input('from', sql.Date, monthFrom)
      .input('to', sql.Date, monthTo)
      .query(`
      SELECT b.BranchCode, l.EntryReason,
        COUNT(*) AS cnt,
        CAST(SUM(l.Amount) AS float) AS total
      FROM dbo.TblEmpLedgerEntry l
      JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
      WHERE l.EmpID = @id AND l.EntryDate >= @from AND l.EntryDate <= @to
        AND ISNULL(l.IsVoided,0)=0
      GROUP BY b.BranchCode, l.EntryReason
      ORDER BY b.BranchCode, l.EntryReason
    `);
    console.log('\n=== LEDGER SUMMARY SEP ===');
    console.log(JSON.stringify(ledSum.recordset, null, 2));

    // Service-line sales attributed to Omar (same source as target engine)
    const lineSales = await db.request()
      .input('id', sql.Int, empId)
      .input('from', sql.Date, monthFrom)
      .input('to', sql.Date, monthTo)
      .query(`
      SELECT CONVERT(varchar(10), CAST(h.invDate AS date), 120) AS D,
        b.BranchCode,
        COUNT(DISTINCT h.invID) AS invoices,
        CAST(SUM(
          CASE
            WHEN ISNULL(d.SValue, 0) > 0
              THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
            ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
          END
        ) AS float) AS lineTotal
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID AND h.invType = d.invType
      JOIN dbo.TblBranch b ON b.BranchID = h.BranchID
      WHERE d.EmpID = @id
        AND CAST(h.invDate AS date) >= @from
        AND CAST(h.invDate AS date) <= @to
        AND h.invType = N'مبيعات'
        AND d.ProID IS NOT NULL
      GROUP BY CONVERT(varchar(10), CAST(h.invDate AS date), 120), b.BranchCode
      ORDER BY D, b.BranchCode
    `);
    console.log('\n=== LINE SALES (detail EmpID) ===');
    console.log(JSON.stringify(lineSales.recordset, null, 2));

    const lineSum = await db.request()
      .input('id', sql.Int, empId)
      .input('from', sql.Date, monthFrom)
      .input('to', sql.Date, monthTo)
      .query(`
      SELECT b.BranchCode,
        COUNT(DISTINCT h.invID) AS invoices,
        CAST(SUM(
          CASE
            WHEN ISNULL(d.SValue, 0) > 0
              THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
            ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
          END
        ) AS float) AS lineTotal
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID AND h.invType = d.invType
      JOIN dbo.TblBranch b ON b.BranchID = h.BranchID
      WHERE d.EmpID = @id
        AND CAST(h.invDate AS date) >= @from
        AND CAST(h.invDate AS date) <= @to
        AND h.invType = N'مبيعات'
        AND d.ProID IS NOT NULL
      GROUP BY b.BranchCode
      ORDER BY b.BranchCode
    `);
    console.log('\n=== LINE SALES MONTH TOTAL ===');
    console.log(JSON.stringify(lineSum.recordset, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
