/**
 * Phase 1E preflight: exact legacy null-BusinessDay cash count on last132.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { connectReadOnly } = require('./_db.cjs');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

(async () => {
  const { pool, target, database } = await connectReadOnly();
  try {
    if (database !== 'last132') throw new Error(`Expected last132, got ${database}`);

    const summary = await pool.request().query(`
      SELECT
        COUNT(*) AS LegacyNullBusinessDayCount,
        MIN(invDate) AS MinDate,
        MAX(invDate) AS MaxDate,
        SUM(ISNULL(GrandTolal, 0)) AS TotalAmount
      FROM dbo.TblCashMove
      WHERE BusinessDayID IS NULL
    `);

    const grouped = await pool.request().query(`
      SELECT
        BranchID,
        CAST(invDate AS date) AS invDate,
        invType,
        inOut,
        ExpINID,
        COUNT(*) AS Cnt,
        SUM(ISNULL(GrandTolal, 0)) AS TotalAmount
      FROM dbo.TblCashMove
      WHERE BusinessDayID IS NULL
      GROUP BY BranchID, CAST(invDate AS date), invType, inOut, ExpINID
      ORDER BY BranchID, invDate, invType, inOut, ExpINID
    `);

    const payload = {
      capturedAt: new Date().toISOString(),
      target,
      database,
      summary: summary.recordset[0],
      grouped: grouped.recordset,
      note:
        'Phase 1E preflight. Reporting ownership uses BranchID; do not require BusinessDayID for inclusion.',
    };

    const out = path.join(__dirname, '_phase1e-legacy-null-businessday.json');
    fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await pool.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
