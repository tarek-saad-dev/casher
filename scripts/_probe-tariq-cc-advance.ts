/**
 * One-off probe: Tariq Camp Caesar advance vs employee ledger. Not for commit.
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
  console.log('FLAG EMP_LEDGER_DUAL_WRITE_ENABLED =', process.env.EMP_LEDGER_DUAL_WRITE_ENABLED);
  console.log('DB =', config.server, config.database);

  const pool = await sql.connect(config);

  const emp = await pool.request().query(`
    SELECT EmpID, EmpName, ISNULL(isActive, 1) AS isActive
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%طارق%'
    ORDER BY EmpID
  `);
  console.log('\n=== EMPLOYEES matching طارق ===');
  console.table(emp.recordset);

  const cc = await pool.request().query(`
    SELECT BranchID, BranchCode, BranchName, IsActive, LifecycleStatus
    FROM dbo.TblBranch
    WHERE BranchCode = N'CAMP_CAESAR'
  `);
  console.log('\n=== CAMP_CAESAR branch ===');
  console.table(cc.recordset);
  const campBranchId = cc.recordset[0]?.BranchID as number | undefined;

  const maps = await pool.request().query(`
    SELECT m.ID, m.EmpID, e.EmpName, m.ExpINID, c.CatName, m.TxnKind, m.IsActive
    FROM dbo.TblExpCatEmpMap m
    INNER JOIN dbo.TblExpINCat c ON c.ExpINID = m.ExpINID
    LEFT JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
    WHERE e.EmpName LIKE N'%طارق%' AND m.TxnKind = N'advance'
    ORDER BY m.ID DESC
  `);
  console.log('\n=== ADVANCE CATEGORY MAPS for طارق ===');
  console.table(maps.recordset);

  const advances = await pool.request().query(`
    SELECT TOP 30
      cm.ID AS cashMoveId,
      cm.invID,
      cm.invDate,
      cm.GrandTolal AS amount,
      cm.BranchID,
      b.BranchCode,
      b.BranchName,
      cm.ExpINID,
      c.CatName,
      cm.Notes
    FROM dbo.TblCashMove cm
    INNER JOIN dbo.TblExpCatEmpMap m
      ON m.ExpINID = cm.ExpINID AND m.TxnKind = N'advance' AND m.IsActive = 1
    INNER JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
    INNER JOIN dbo.TblExpINCat c ON c.ExpINID = cm.ExpINID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
    WHERE cm.invType = N'مصروفات'
      AND cm.inOut = N'out'
      AND e.EmpName LIKE N'%طارق%'
    ORDER BY cm.invDate DESC, cm.ID DESC
  `);
  console.log('\n=== ALL ADVANCE CASH MOVES for طارق ===');
  console.table(advances.recordset);

  if (campBranchId) {
    const ccAdv = await pool.request()
      .input('branchId', sql.Int, campBranchId)
      .query(`
        SELECT TOP 20
          cm.ID AS cashMoveId,
          cm.invID,
          cm.invDate,
          cm.GrandTolal AS amount,
          cm.BranchID,
          c.CatName,
          e.EmpName
        FROM dbo.TblCashMove cm
        INNER JOIN dbo.TblExpCatEmpMap m
          ON m.ExpINID = cm.ExpINID AND m.TxnKind = N'advance' AND m.IsActive = 1
        INNER JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
        INNER JOIN dbo.TblExpINCat c ON c.ExpINID = cm.ExpINID
        WHERE cm.invType = N'مصروفات'
          AND cm.inOut = N'out'
          AND cm.BranchID = @branchId
          AND e.EmpName LIKE N'%طارق%'
        ORDER BY cm.invDate DESC, cm.ID DESC
      `);
    console.log('\n=== CAMP CAESAR ADVANCE CASH MOVES for طارق ===');
    console.table(ccAdv.recordset);
  }

  const ledger = await pool.request().query(`
    SELECT
      l.ID,
      l.EmpID,
      e.EmpName,
      l.BranchID,
      b.BranchCode,
      l.EntryDate,
      l.EntryReason,
      l.EntryDirection,
      l.Amount,
      l.PayrollMonth,
      l.CashMoveID,
      l.IsVoided,
      l.Notes
    FROM dbo.TblEmpLedgerEntry l
    INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
    WHERE e.EmpName LIKE N'%طارق%'
      AND l.EntryReason = N'advance'
    ORDER BY l.EntryDate DESC, l.ID DESC
  `);
  console.log('\n=== LEDGER ADVANCE ENTRIES for طارق ===');
  console.table(ledger.recordset);

  const missing = await pool.request().query(`
    SELECT
      cm.ID AS cashMoveId,
      cm.invID,
      cm.invDate,
      cm.GrandTolal AS amount,
      cm.BranchID,
      b.BranchCode,
      e.EmpID,
      e.EmpName
    FROM dbo.TblCashMove cm
    INNER JOIN dbo.TblExpCatEmpMap m
      ON m.ExpINID = cm.ExpINID AND m.TxnKind = N'advance' AND m.IsActive = 1
    INNER JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = cm.BranchID
    LEFT JOIN dbo.TblEmpLedgerEntry l
      ON l.CashMoveID = cm.ID
     AND l.EntryReason = N'advance'
     AND l.IsVoided = 0
    WHERE cm.invType = N'مصروفات'
      AND cm.inOut = N'out'
      AND e.EmpName LIKE N'%طارق%'
      AND l.ID IS NULL
    ORDER BY cm.invDate DESC
  `);
  console.log('\n=== ADVANCE CASH MOVES WITHOUT LEDGER ENTRY (طارق) ===');
  console.table(missing.recordset);

  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
