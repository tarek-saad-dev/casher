import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const sql = (await import('mssql')).default;
  const db = await sql.connect({
    server: '127.0.0.1', port: 14330, database: 'last132',
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const batch = await db.request().query(`
    SELECT cm.ID, cm.invTime, cm.GrandTolal, b.BranchCode, ISNULL(cat.CatName, cm.invType) AS CatName,
      cm.ShiftMoveID, u.UserName, cm.invType, cm.inOut
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblBranch b ON b.BranchID=cm.BranchID
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID=cm.ExpINID
    LEFT JOIN dbo.TblShiftMove sm ON sm.ID=cm.ShiftMoveID
    LEFT JOIN dbo.TblUser u ON u.UserID=sm.UserID
    WHERE cm.ID BETWEEN 39395 AND 39412
    ORDER BY cm.ID
  `);
  console.log('BATCH', JSON.stringify(batch.recordset, null, 2));

  const shifts = await db.request().query(`
    SELECT sm.ID, b.BranchCode, u.UserName, sm.StartTime, sm.EndTime, sm.Status, sm.UserID
    FROM dbo.TblShiftMove sm
    JOIN dbo.TblBranch b ON b.BranchID=sm.BranchID
    JOIN dbo.TblUser u ON u.UserID=sm.UserID
    WHERE sm.ID IN (12146,12147)
  `);
  console.log('SHIFTS', JSON.stringify(shifts.recordset, null, 2));

  // Check if deductions route creates معادلة for these
  const settlement = await db.request().query(`
    SELECT cm.ID, cm.GrandTolal, b.BranchCode, cat.CatName, cm.Notes
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID=cm.ExpINID
    LEFT JOIN dbo.TblBranch b ON b.BranchID=cm.BranchID
    WHERE cm.invDate='2026-08-28' AND cat.CatName LIKE N'%معادلة%'
      AND cm.ShiftMoveID IN (12146,12147)
  `);
  console.log('SETTLEMENT', JSON.stringify(settlement.recordset, null, 2));

  // ExpINID uniqueness - one category for Omar across branches
  const expCat = await db.request().query(`
    SELECT c.ExpINID, c.CatName, m.EmpID, e.EmpName, m.TxnKind
    FROM dbo.TblExpINCat c
    JOIN dbo.TblExpCatEmpMap m ON m.ExpINID=c.ExpINID
    JOIN dbo.TblEmp e ON e.EmpID=m.EmpID
    WHERE e.EmpID=25 AND m.TxnKind='advance'
  `);
  console.log('OMAR EXP CAT', JSON.stringify(expCat.recordset, null, 2));

  await db.close();
}
main().catch(e => { console.error(e); process.exit(1); });
