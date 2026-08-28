/**
 * Probe all Camp Caesar advances missing ledger entries. Not for commit.
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const config: sql.config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || 'HawaiRestaurant',
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: {
    encrypt: process.env.CLOUD_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
    trustServerCertificate:
      process.env.CLOUD_DB_TRUST_CERT === 'true' ||
      process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 120000,
};

async function main() {
  const month = process.argv[2] || '2026-08';
  const pool = await sql.connect(config);

  const cc = await pool.request().query(`
    SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'CAMP_CAESAR'
  `);
  const campBranchId = Number(cc.recordset[0]?.BranchID);
  if (!campBranchId) throw new Error('CAMP_CAESAR branch not found');

  const [y, m] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const missing = await pool.request()
    .input('branchId', sql.Int, campBranchId)
    .input('monthStart', sql.Date, monthStart)
    .input('monthEnd', sql.Date, monthEnd)
    .query(`
      SELECT
        e.EmpID,
        e.EmpName,
        COUNT(*) AS missingCount,
        SUM(cm.GrandTolal) AS missingTotal
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpCatEmpMap map
        ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance' AND map.IsActive = 1
      INNER JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
      LEFT JOIN dbo.TblEmpLedgerEntry l
        ON l.CashMoveID = cm.ID AND l.EntryReason = N'advance' AND l.IsVoided = 0
      WHERE cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND cm.BranchID = @branchId
        AND cm.invDate >= @monthStart
        AND cm.invDate <= @monthEnd
        AND cm.GrandTolal > 0
        AND l.ID IS NULL
      GROUP BY e.EmpID, e.EmpName
      ORDER BY missingTotal DESC, e.EmpName
    `);

  console.log(`Month ${month} — Camp Caesar advances WITHOUT ledger entry:`);
  console.table(missing.recordset);

  const totals = await pool.request()
    .input('branchId', sql.Int, campBranchId)
    .input('monthStart', sql.Date, monthStart)
    .input('monthEnd', sql.Date, monthEnd)
    .query(`
      SELECT
        COUNT(*) AS missingMoves,
        ISNULL(SUM(cm.GrandTolal), 0) AS missingAmount
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpCatEmpMap map
        ON map.ExpINID = cm.ExpINID AND map.TxnKind = N'advance' AND map.IsActive = 1
      LEFT JOIN dbo.TblEmpLedgerEntry l
        ON l.CashMoveID = cm.ID AND l.EntryReason = N'advance' AND l.IsVoided = 0
      WHERE cm.invType = N'مصروفات'
        AND cm.inOut = N'out'
        AND cm.BranchID = @branchId
        AND cm.invDate >= @monthStart
        AND cm.invDate <= @monthEnd
        AND cm.GrandTolal > 0
        AND l.ID IS NULL
    `);
  console.log('TOTAL missing:', totals.recordset[0]);

  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
