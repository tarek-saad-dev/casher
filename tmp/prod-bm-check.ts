#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

async function main() {
  const { getPool, closePool } = await import('../src/lib/db');
  const pool = await getPool();
  const tables = await pool.request().query(`
    SELECT name FROM sys.tables
    WHERE name IN (
      N'TblBotBookingManagementPlan',
      N'TblPublicBookingRescheduleRequest'
    )
    ORDER BY name
  `);
  console.log('tables', tables.recordset);
  const ver = await pool.request().query('SELECT @@VERSION AS v');
  console.log('sql', String(ver.recordset[0]?.v ?? '').split('\n')[0]);
  const phone = process.argv[2] || '201557994946';
  const upcoming = await pool.request().input('phone', phone).query(`
    SELECT TOP 5 b.BookingCode, b.Status, b.BookingDate, b.StartTime, e.EmpName, br.BranchName
    FROM dbo.Bookings b
    INNER JOIN dbo.TblClient c ON c.ClientID = b.ClientID
    LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
    LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
    WHERE c.Mobile = @phone AND b.CancelledAt IS NULL
      AND b.Status IN ('confirmed','arrived','queued')
    ORDER BY b.BookingDate, b.StartTime
  `);
  console.log('upcoming', upcoming.recordset);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
