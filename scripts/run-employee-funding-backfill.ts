#!/usr/bin/env npx tsx
/**
 * Employee funding backfill CLI (standalone SQL — no Next server-only imports).
 *
 * Usage:
 *   npx tsx scripts/run-employee-funding-backfill.ts 2026-07
 *   npx tsx scripts/run-employee-funding-backfill.ts 2026-07 --apply
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
  requestTimeout: 180000,
};

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

function fmtDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function loadMissing(pool: sql.ConnectionPool, startDate: string, endDate: string) {
  return pool.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      SELECT
        cm.ID AS cashMoveId,
        map.EmpID AS empId,
        e.EmpName AS empName,
        cm.invDate,
        CAST(cm.GrandTolal AS decimal(12,2)) AS amount,
        cat.CatName AS categoryName,
        cm.ExpINID AS expInId
      FROM dbo.TblCashMove cm
      INNER JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
      CROSS APPLY (
        SELECT TOP 1 m.EmpID
        FROM dbo.TblExpCatEmpMap m
        WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
        ORDER BY m.ID DESC
      ) map
      LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
      WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
        AND cm.invDate >= @startDate AND cm.invDate <= @endDate
        AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpLedgerEntry l
          WHERE l.CashMoveID = cm.ID
            AND l.EntryReason = N'employee_funding'
            AND l.IsVoided = 0
        )
      ORDER BY cm.invDate, cm.ID
    `);
}

async function reconcile(pool: sql.ConnectionPool, startDate: string, endDate: string) {
  return pool.request()
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      ;WITH linked AS (
        SELECT map.EmpID AS empId,
          ISNULL(e.EmpName, N'?') AS empName,
          CAST(SUM(cm.GrandTolal) AS decimal(12,2)) AS linkedTotal
        FROM dbo.TblCashMove cm
        CROSS APPLY (
          SELECT TOP 1 m.EmpID FROM dbo.TblExpCatEmpMap m
          WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
          ORDER BY m.ID DESC
        ) map
        LEFT JOIN dbo.TblEmp e ON e.EmpID = map.EmpID
        WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
          AND cm.invDate >= @startDate AND cm.invDate <= @endDate
          AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
        GROUP BY map.EmpID, e.EmpName
      ),
      funding AS (
        SELECT l.EmpID AS empId,
          CAST(SUM(l.Amount) AS decimal(12,2)) AS fundingTotal
        FROM dbo.TblEmpLedgerEntry l
        INNER JOIN dbo.TblCashMove cm ON cm.ID = l.CashMoveID
        CROSS APPLY (
          SELECT TOP 1 m.EmpID FROM dbo.TblExpCatEmpMap m
          WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
          ORDER BY m.ID DESC
        ) map
        WHERE l.EntryReason = N'employee_funding' AND l.IsVoided = 0
          AND l.EntryDate >= @startDate AND l.EntryDate <= @endDate
          AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
        GROUP BY l.EmpID
      ),
      missing AS (
        SELECT map.EmpID AS empId, COUNT(*) AS missingCnt
        FROM dbo.TblCashMove cm
        CROSS APPLY (
          SELECT TOP 1 m.EmpID FROM dbo.TblExpCatEmpMap m
          WHERE m.ExpINID = cm.ExpINID AND m.TxnKind = N'revenue' AND m.IsActive = 1
          ORDER BY m.ID DESC
        ) map
        WHERE cm.invType = N'ايرادات' AND cm.inOut = N'in'
          AND cm.invDate >= @startDate AND cm.invDate <= @endDate
          AND ISNULL(cm.IsEmployeePayrollIncome, 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM dbo.TblEmpLedgerEntry l
            WHERE l.CashMoveID = cm.ID AND l.EntryReason = N'employee_funding' AND l.IsVoided = 0
          )
        GROUP BY map.EmpID
      )
      SELECT
        linked.empId,
        linked.empName,
        linked.linkedTotal,
        ISNULL(funding.fundingTotal, 0) AS fundingTotal,
        linked.linkedTotal - ISNULL(funding.fundingTotal, 0) AS diff,
        ISNULL(missing.missingCnt, 0) AS missingCnt
      FROM linked
      LEFT JOIN funding ON funding.empId = linked.empId
      LEFT JOIN missing ON missing.empId = linked.empId
      ORDER BY linked.empName
    `);
}

async function upsertFunding(
  tx: sql.Transaction,
  row: {
    cashMoveId: number;
    empId: number;
    invDate: string;
    amount: number;
    categoryName: string | null;
  },
): Promise<'inserted' | 'updated'> {
  const payrollMonth = row.invDate.slice(0, 7);
  const notes = `تمويل من موظف للمحل — فئة: ${row.categoryName ?? 'بدون فئة'} — CashMove#${row.cashMoveId}`;

  await new sql.Request(tx)
    .input('CashMoveID', sql.Int, row.cashMoveId)
    .input('EmpID', sql.Int, row.empId)
    .query(`UPDATE dbo.TblCashMove SET EmpID = @EmpID WHERE ID = @CashMoveID`);

  const upd = await new sql.Request(tx)
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.invDate)
    .input('Amount', sql.Decimal(12, 2), row.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, row.cashMoveId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('RefType', sql.NVarChar(80), 'TblCashMove')
    .input('RefID', sql.Int, row.cashMoveId)
    .input('EntryReason', sql.NVarChar(40), 'employee_funding')
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET EmpID=@EmpID, EntryDate=@EntryDate, Amount=@Amount, PayrollMonth=@PayrollMonth,
          CashMoveID=@CashMoveID, Notes=@Notes, UpdatedAt=SYSDATETIME(),
          IsVoided=0, VoidReason=NULL
      WHERE RefType=@RefType AND RefID=@RefID AND EntryReason=@EntryReason AND IsVoided=0
    `);

  if (Number(upd.rowsAffected[0] ?? 0) > 0) return 'updated';

  const revive = await new sql.Request(tx)
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.invDate)
    .input('Amount', sql.Decimal(12, 2), row.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, row.cashMoveId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('RefType', sql.NVarChar(80), 'TblCashMove')
    .input('RefID', sql.Int, row.cashMoveId)
    .input('EntryReason', sql.NVarChar(40), 'employee_funding')
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET EmpID=@EmpID, EntryDate=@EntryDate, Amount=@Amount, PayrollMonth=@PayrollMonth,
          CashMoveID=@CashMoveID, Notes=@Notes, UpdatedAt=SYSDATETIME(),
          IsVoided=0, VoidReason=NULL
      WHERE RefType=@RefType AND RefID=@RefID AND EntryReason=@EntryReason AND IsVoided=1
    `);
  if (Number(revive.rowsAffected[0] ?? 0) > 0) return 'updated';

  await new sql.Request(tx)
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.invDate)
    .input('Amount', sql.Decimal(12, 2), row.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('CashMoveID', sql.Int, row.cashMoveId)
    .input('Notes', sql.NVarChar(500), notes)
    .input('RefType', sql.NVarChar(80), 'TblCashMove')
    .input('RefID', sql.Int, row.cashMoveId)
    .input('EntryReason', sql.NVarChar(40), 'employee_funding')
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      VALUES (
        @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
        @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
        @Notes, 0, NULL, SYSDATETIME()
      )
    `);
  return 'inserted';
}

async function main() {
  const month = process.argv[2] || '2026-07';
  const apply = process.argv.includes('--apply');
  const { startDate, endDate } = monthBounds(month);

  console.log(`FLAG=${process.env.EMP_LEDGER_DUAL_WRITE_ENABLED} month=${month} apply=${apply}`);
  const pool = await sql.connect(config);

  const before = await reconcile(pool, startDate, endDate);
  console.log('\n=== BEFORE reconciliation ===');
  console.table(before.recordset);

  const missing = await loadMissing(pool, startDate, endDate);
  console.log(`\nMissing rows: ${missing.recordset.length}`);
  console.table(
    missing.recordset.map((r) => ({
      cashMoveId: r.cashMoveId,
      emp: r.empName,
      date: fmtDate(r.invDate),
      amount: Number(r.amount),
      cat: r.categoryName,
    })),
  );

  if (!apply) {
    console.log('\nRe-run with --apply to insert.');
    await pool.close();
    process.exit(0);
  }

  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const row of missing.recordset) {
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      const outcome = await upsertFunding(tx, {
        cashMoveId: Number(row.cashMoveId),
        empId: Number(row.empId),
        invDate: fmtDate(row.invDate),
        amount: Math.abs(Number(row.amount)),
        categoryName: row.categoryName != null ? String(row.categoryName) : null,
      });
      await tx.commit();
      if (outcome === 'inserted') inserted += 1;
      else updated += 1;
    } catch (err) {
      try { await tx.rollback(); } catch { /* ignore */ }
      errors.push(`CashMove#${row.cashMoveId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\nAPPLY:', { inserted, updated, errors: errors.length });
  if (errors.length) console.log(errors);

  const after = await reconcile(pool, startDate, endDate);
  console.log('\n=== AFTER reconciliation ===');
  console.table(after.recordset);

  const missing2 = await loadMissing(pool, startDate, endDate);
  console.log('\nSECOND pass missing:', missing2.recordset.length);

  await pool.close();

  const ok =
    errors.length === 0
    && missing2.recordset.length === 0
    && after.recordset.every((r) => Number(r.diff) === 0 && Number(r.missingCnt) === 0);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
