#!/usr/bin/env npx tsx
/**
 * Heal missing hourly_wage ledger rows for Generated daily payroll.
 * Usage: npx tsx scripts/heal-payroll-ledger-gap.ts [YYYY-MM-DD] [branchId]
 */
import path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function main() {
  const workDate = process.argv[2] || '2026-08-01';
  const branchId = process.argv[3] ? Number(process.argv[3]) : 1;

  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || '',
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
  });

  const before = await pool
    .request()
    .input('d', sql.Date, workDate)
    .input('b', sql.Int, branchId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll
         WHERE WorkDate=@d AND BranchID=@b AND Status=N'Generated') AS payrollCnt,
        (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry l
         WHERE l.IsVoided=0 AND l.EntryReason=N'hourly_wage'
           AND l.RefType=N'TblEmpDailyPayroll'
           AND l.RefID IN (
             SELECT ID FROM dbo.TblEmpDailyPayroll WHERE WorkDate=@d AND BranchID=@b AND Status=N'Generated'
           )) AS ledgerCnt
    `);
  console.log('before', before.recordset[0]);

  const payroll = await pool
    .request()
    .input('d', sql.Date, workDate)
    .input('b', sql.Int, branchId)
    .query(`
      SELECT p.ID AS payrollId, p.EmpID AS empId, p.BranchID AS branchId,
             CONVERT(varchar(10), p.WorkDate, 23) AS workDate,
             p.AttendanceID AS attendanceId, p.DailyWage AS dailyWage
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.WorkDate = @d AND p.BranchID = @b AND p.Status = N'Generated'
    `);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of payroll.recordset) {
    const payrollId = Number(row.payrollId);
    const dailyWage = Number(row.dailyWage ?? 0);
    const wd = String(row.workDate).slice(0, 10);
    const payrollMonth = wd.slice(0, 7);
    const notes = `استحقاق يومية/ساعات بتاريخ ${wd}`;

    if (dailyWage <= 0) {
      skipped++;
      continue;
    }

    const upd = await pool
      .request()
      .input('EmpID', sql.Int, Number(row.empId))
      .input('EntryDate', sql.Date, wd)
      .input('Amount', sql.Decimal(12, 2), dailyWage)
      .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
      .input('AttendanceID', sql.Int, row.attendanceId != null ? Number(row.attendanceId) : null)
      .input('Notes', sql.NVarChar(500), notes)
      .input('RefType', sql.NVarChar(80), 'TblEmpDailyPayroll')
      .input('RefID', sql.Int, payrollId)
      .input('EntryReason', sql.NVarChar(40), 'hourly_wage')
      .query(`
        UPDATE dbo.TblEmpLedgerEntry
        SET EmpID=@EmpID, EntryDate=@EntryDate, Amount=@Amount, PayrollMonth=@PayrollMonth,
            AttendanceID=@AttendanceID, Notes=@Notes, UpdatedAt=SYSDATETIME()
        WHERE RefType=@RefType AND RefID=@RefID AND EntryReason=@EntryReason AND IsVoided=0
      `);

    if (upd.rowsAffected[0] > 0) {
      updated++;
      continue;
    }

    await pool
      .request()
      .input('EmpID', sql.Int, Number(row.empId))
      .input('BranchID', sql.Int, Number(row.branchId))
      .input('EntryDate', sql.Date, wd)
      .input('EntryReason', sql.NVarChar(40), 'hourly_wage')
      .input('Amount', sql.Decimal(12, 2), dailyWage)
      .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
      .input('AttendanceID', sql.Int, row.attendanceId != null ? Number(row.attendanceId) : null)
      .input('Notes', sql.NVarChar(500), notes)
      .input('RefType', sql.NVarChar(80), 'TblEmpDailyPayroll')
      .input('RefID', sql.Int, payrollId)
      .query(`
        INSERT INTO dbo.TblEmpLedgerEntry (
          BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
          PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
          Notes, IsVoided, CreatedAt
        )
        VALUES (
          @BranchID, @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
          @PayrollMonth, @RefType, @RefID, NULL, @AttendanceID,
          @Notes, 0, SYSDATETIME()
        )
      `);
    inserted++;
  }

  console.log({ inserted, updated, skipped });

  const after = await pool
    .request()
    .input('d', sql.Date, workDate)
    .input('b', sql.Int, branchId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll
         WHERE WorkDate=@d AND BranchID=@b AND Status=N'Generated') AS payrollCnt,
        (SELECT COUNT(*) FROM dbo.TblEmpLedgerEntry l
         WHERE l.IsVoided=0 AND l.EntryReason=N'hourly_wage'
           AND l.RefType=N'TblEmpDailyPayroll'
           AND l.RefID IN (
             SELECT ID FROM dbo.TblEmpDailyPayroll WHERE WorkDate=@d AND BranchID=@b AND Status=N'Generated'
           )) AS ledgerCnt,
        (SELECT SUM(CAST(Amount AS DECIMAL(12,2))) FROM dbo.TblEmpLedgerEntry l
         WHERE l.IsVoided=0 AND l.EntryReason=N'hourly_wage'
           AND l.RefType=N'TblEmpDailyPayroll'
           AND l.RefID IN (
             SELECT ID FROM dbo.TblEmpDailyPayroll WHERE WorkDate=@d AND BranchID=@b AND Status=N'Generated'
           )) AS ledgerAmt
    `);
  console.log('after', after.recordset[0]);
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
