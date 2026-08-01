/**
 * Backfill missing employee_funding for specific CashMoves (SELECT + INSERT).
 * Usage: npx tsx scripts/backfill-missing-funding-cashmoves.ts [--apply]
 */
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const apply = process.argv.includes('--apply');
const ids = [36691, 36662]; // Ziad 4000, Mohamed 25

const config: sql.config = {
  server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
  user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  requestTimeout: 120000,
};

async function main() {
  const pool = await sql.connect(config);
  const idList = ids.join(',');

  const rows = await pool.request().query(`
    SELECT
      cm.ID AS cashMoveId,
      cm.BranchID,
      cm.invDate,
      cm.GrandTolal AS amount,
      c.CatName,
      map.EmpID,
      e.EmpName,
      funding.ID AS existingFundingId
    FROM dbo.TblCashMove cm
    INNER JOIN dbo.TblExpINCat c ON c.ExpINID = cm.ExpINID
    CROSS APPLY (
      SELECT TOP 1 m.EmpID
      FROM dbo.TblExpCatEmpMap m
      WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
      ORDER BY m.ID DESC
    ) map
    LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
    OUTER APPLY (
      SELECT TOP 1 l.ID
      FROM dbo.TblEmpLedgerEntry l
      WHERE l.CashMoveID = cm.ID AND l.EntryReason = N'employee_funding' AND l.IsVoided = 0
    ) funding
    WHERE cm.ID IN (${idList})
  `);

  console.log('Candidates');
  console.table(rows.recordset);
  console.log(apply ? 'APPLYING...' : 'DRY RUN (pass --apply to write)');

  if (!apply) {
    await pool.close();
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const row of rows.recordset as any[]) {
      if (row.existingFundingId) {
        console.log('skip already funded', row.cashMoveId);
        continue;
      }
      const entryDate = row.invDate instanceof Date
        ? row.invDate.toISOString().slice(0, 10)
        : String(row.invDate).slice(0, 10);
      const payrollMonth = entryDate.slice(0, 7);
      const notes = `تمويل من موظف للمحل — فئة: ${row.CatName} — CashMove#${row.cashMoveId}`;

      await new sql.Request(tx)
        .input('CashMoveID', sql.Int, row.cashMoveId)
        .input('EmpID', sql.Int, row.EmpID)
        .query(`UPDATE dbo.TblCashMove SET EmpID = @EmpID WHERE ID = @CashMoveID`);

      await new sql.Request(tx)
        .input('BranchID', sql.Int, row.BranchID)
        .input('EmpID', sql.Int, row.EmpID)
        .input('EntryDate', sql.Date, entryDate)
        .input('Amount', sql.Decimal(12, 2), Number(row.amount))
        .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
        .input('CashMoveID', sql.Int, row.cashMoveId)
        .input('Notes', sql.NVarChar(500), notes)
        .query(`
          INSERT INTO dbo.TblEmpLedgerEntry (
            BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
            PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
            Notes, IsVoided, CreatedByUserID, CreatedAt
          )
          VALUES (
            @BranchID, @EmpID, @EntryDate, N'credit', N'employee_funding', @Amount,
            @PayrollMonth, N'TblCashMove', @CashMoveID, @CashMoveID, NULL,
            @Notes, 0, NULL, SYSDATETIME()
          )
        `);
      console.log('inserted funding for', row.cashMoveId, row.EmpName, row.amount);
    }
    await tx.commit();
    console.log('DONE');
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
