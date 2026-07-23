/**
 * Phase 1E: capture GLEEM report baseline BEFORE / AFTER branch-scoped rewrites.
 * No client PII. Uses report services with optional branchId when available.
 *
 * Usage:
 *   node scripts/audit-branches/09-capture-phase1e-report-baseline.cjs before
 *   node scripts/audit-branches/09-capture-phase1e-report-baseline.cjs after
 *
 * When mode=before and services still lack branchId, captures unscoped totals
 * (equivalent to GLEEM-only data). When mode=after, prefers branch-scoped calls.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function capture(pool, gleemId) {
  // Representative dates from live patterns
  const days = ['2026-07-11', '2026-06-15', '2026-05-23'];
  const month = { year: 2026, month: 6 };

  const dayTotals = [];
  for (const d of days) {
    const sales = await pool
      .request()
      .input('d', d)
      .input('b', gleemId)
      .query(`
        SELECT
          COUNT(*) AS invoiceCount,
          ISNULL(SUM(GrandTotal), 0) AS totalSales
        FROM dbo.TblinvServHead
        WHERE CAST(invDate AS date) = @d AND BranchID = @b AND invType = N'مبيعات'
      `);
    const cash = await pool
      .request()
      .input('d', d)
      .input('b', gleemId)
      .query(`
        SELECT
          ISNULL(SUM(CASE WHEN inOut = N'in' THEN GrandTolal ELSE 0 END), 0) AS cashIn,
          ISNULL(SUM(CASE WHEN inOut = N'out' THEN GrandTolal ELSE 0 END), 0) AS cashOut,
          COUNT(*) AS cashCount
        FROM dbo.TblCashMove
        WHERE CAST(invDate AS date) = @d AND BranchID = @b
      `);
    dayTotals.push({
      date: d,
      sales: sales.recordset[0],
      cash: cash.recordset[0],
    });
  }

  const monthFrom = `${month.year}-${String(month.month).padStart(2, '0')}-01`;
  const monthTo = `${month.year}-${String(month.month).padStart(2, '0')}-30`;
  const monthAgg = await pool
    .request()
    .input('from', monthFrom)
    .input('to', monthTo)
    .input('b', gleemId)
    .query(`
      SELECT
        (SELECT ISNULL(SUM(GrandTotal),0) FROM dbo.TblinvServHead
          WHERE CAST(invDate AS date) BETWEEN @from AND @to AND BranchID=@b AND invType=N'مبيعات') AS salesTotal,
        (SELECT ISNULL(SUM(CASE WHEN inOut=N'in' THEN GrandTolal ELSE 0 END),0) FROM dbo.TblCashMove
          WHERE CAST(invDate AS date) BETWEEN @from AND @to AND BranchID=@b) AS cashIn,
        (SELECT ISNULL(SUM(CASE WHEN inOut=N'out' THEN GrandTolal ELSE 0 END),0) FROM dbo.TblCashMove
          WHERE CAST(invDate AS date) BETWEEN @from AND @to AND BranchID=@b) AS cashOut
    `);

  const legacy = await pool.request().input('b', gleemId).query(`
    SELECT
      COUNT(*) AS cnt,
      SUM(ISNULL(GrandTolal,0)) AS total
    FROM dbo.TblCashMove
    WHERE BranchID = @b AND BusinessDayID IS NULL
      AND CAST(invDate AS date) = '2024-01-01'
  `);

  const unscopedVsScoped = await pool.request().input('b', gleemId).input('d', '2026-07-11').query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE CAST(invDate AS date)=@d AND invType=N'مبيعات') AS unscopedInv,
      (SELECT COUNT(*) FROM dbo.TblinvServHead WHERE CAST(invDate AS date)=@d AND invType=N'مبيعات' AND BranchID=@b) AS scopedInv,
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE CAST(invDate AS date)=@d) AS unscopedCash,
      (SELECT COUNT(*) FROM dbo.TblCashMove WHERE CAST(invDate AS date)=@d AND BranchID=@b) AS scopedCash
  `);

  return {
    gleemBranchId: gleemId,
    dayTotals,
    month2026_06: monthAgg.recordset[0],
    legacyNullDayCash: legacy.recordset[0],
    unscopedVsScopedSameDay: unscopedVsScoped.recordset[0],
  };
}

async function main() {
  const mode = process.argv[2] || 'before';
  const { pool, target, database } = await connectReadOnly();
  try {
    if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);
    const gleem = await pool.request().query(`
      SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    const gleemId = gleem.recordset[0]?.BranchID;
    if (!gleemId) throw new Error('GLEEM missing');

    const payload = {
      capturedAt: new Date().toISOString(),
      mode,
      target,
      database,
      note: 'Branch-filtered fingerprints; with single founding branch unscoped==scoped',
      ...(await capture(pool, gleemId)),
    };

    const out = path.join(__dirname, `_phase1e-report-baseline-${mode}.json`);
    fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify({ mode, out: path.relative(process.cwd(), out), payload }, null, 2));
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
