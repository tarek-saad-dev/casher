#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Read-only audit for Phase 1 Employee HR model columns and backfill coverage.
 */

const sql = require('mssql');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const config = {
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
  requestTimeout: 60000,
};

const PHASE1_COLUMNS = ['EmploymentType', 'PayrollMethod', 'DailyRate', 'ManualHourlyRate'];

async function columnExists(pool, tableName, columnName) {
  const r = await pool.request()
    .input('tableName', sql.NVarChar(128), tableName)
    .input('columnName', sql.NVarChar(128), columnName)
    .query(`
      SELECT 1 AS ok
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo'
        AND TABLE_NAME = @tableName
        AND COLUMN_NAME = @columnName
    `);
  return r.recordset.length > 0;
}

function section(title) {
  console.log('\n' + '═'.repeat(60));
  console.log(title);
  console.log('═'.repeat(60));
}

async function main() {
  if (!config.server || !config.user) {
    console.error('Missing DB credentials. Set DB_SERVER / DB_USER / DB_PASSWORD in .env or .env.local');
    process.exit(1);
  }

  console.log('Employee HR Model — Phase 1 Audit (read-only)');
  console.log('Database:', config.database, '@', config.server);

  const pool = await sql.connect(config);

  section('Column existence (TblEmp)');
  for (const col of PHASE1_COLUMNS) {
    const exists = await columnExists(pool, 'TblEmp', col);
    console.log(`  ${col}: ${exists ? 'YES' : 'NO'}`);
  }

  const hasEmpType = await columnExists(pool, 'TblEmp', 'EmploymentType');
  const hasPayMethod = await columnExists(pool, 'TblEmp', 'PayrollMethod');

  if (!hasEmpType || !hasPayMethod) {
    console.log('\n⚠ Phase 1 columns missing. Run: node scripts/run-employee-hr-model-phase1-migration.js');
    await pool.close();
    process.exit(0);
  }

  section('Counts by EmploymentType');
  const byEmpType = await pool.request().query(`
    SELECT ISNULL(EmploymentType, N'NULL') AS EmploymentType, COUNT(*) AS EmployeeCount
    FROM dbo.TblEmp
    GROUP BY EmploymentType
    ORDER BY EmploymentType
  `);
  console.table(byEmpType.recordset);

  section('Counts by PayrollMethod');
  const byPayMethod = await pool.request().query(`
    SELECT ISNULL(PayrollMethod, N'NULL') AS PayrollMethod, COUNT(*) AS EmployeeCount
    FROM dbo.TblEmp
    GROUP BY PayrollMethod
    ORDER BY PayrollMethod
  `);
  console.table(byPayMethod.recordset);

  section('Employees with NULL EmploymentType');
  const nullEmpType = await pool.request().query(`
    SELECT EmpID, EmpName, isActive, SalaryType
    FROM dbo.TblEmp
    WHERE EmploymentType IS NULL
    ORDER BY EmpName
  `);
  if (nullEmpType.recordset.length === 0) {
    console.log('  (none)');
  } else {
    console.table(nullEmpType.recordset);
  }

  section('Employees with NULL PayrollMethod');
  const nullPayMethod = await pool.request().query(`
    SELECT EmpID, EmpName, isActive, SalaryType, IsPayrollEnabled
    FROM dbo.TblEmp
    WHERE PayrollMethod IS NULL
    ORDER BY EmpName
  `);
  if (nullPayMethod.recordset.length === 0) {
    console.log('  (none)');
  } else {
    console.table(nullPayMethod.recordset);
  }

  section('freelance + monthly violations (should be empty)');
  const violations = await pool.request().query(`
    SELECT EmpID, EmpName, EmploymentType, PayrollMethod, SalaryType
    FROM dbo.TblEmp
    WHERE EmploymentType = N'freelance' AND PayrollMethod = N'monthly'
    ORDER BY EmpName
  `);
  if (violations.recordset.length === 0) {
    console.log('  ✓ No violations');
  } else {
    console.table(violations.recordset);
  }

  const hasExempt = await columnExists(pool, 'TblEmp', 'IsAttendanceExempt');
  if (hasExempt) {
    section('Employees with IsAttendanceExempt = 1');
    const exempt = await pool.request().query(`
      SELECT EmpID, EmpName, EmploymentType, PayrollMethod, IsAttendanceExempt
      FROM dbo.TblEmp
      WHERE IsAttendanceExempt = 1
      ORDER BY EmpName
    `);
    if (exempt.recordset.length === 0) {
      console.log('  (none)');
    } else {
      console.table(exempt.recordset);
    }
  } else {
    section('IsAttendanceExempt column');
    console.log('  Column not present on TblEmp');
  }

  const scheduleTable = await pool.request().query(`
    SELECT OBJECT_ID(N'dbo.TblEmpWorkSchedule', N'U') AS oid
  `);
  const hasSchedule = scheduleTable.recordset[0].oid != null;

  if (hasSchedule) {
    section('Schedule working-day distribution (active employees)');

    const scheduleStats = await pool.request().query(`
      WITH wd AS (
        SELECT
          e.EmpID,
          e.EmpName,
          e.EmploymentType,
          COUNT(ws.ID) AS ScheduleRows,
          SUM(CASE WHEN ws.IsWorkingDay = 1 THEN 1 ELSE 0 END) AS WorkingDays
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID = e.EmpID
        WHERE ISNULL(e.isActive, 1) = 1
        GROUP BY e.EmpID, e.EmpName, e.EmploymentType
      )
      SELECT
        CASE
          WHEN ScheduleRows = 0 THEN N'0 schedule rows'
          WHEN WorkingDays = 0 THEN N'0 working days'
          WHEN WorkingDays BETWEEN 1 AND 5 THEN N'1-5 working days'
          WHEN WorkingDays = 6 THEN N'6 working days'
          WHEN WorkingDays = 7 THEN N'7 working days'
          ELSE N'other'
        END AS Bucket,
        COUNT(*) AS EmployeeCount
      FROM wd
      GROUP BY
        CASE
          WHEN ScheduleRows = 0 THEN N'0 schedule rows'
          WHEN WorkingDays = 0 THEN N'0 working days'
          WHEN WorkingDays BETWEEN 1 AND 5 THEN N'1-5 working days'
          WHEN WorkingDays = 6 THEN N'6 working days'
          WHEN WorkingDays = 7 THEN N'7 working days'
          ELSE N'other'
        END
      ORDER BY Bucket
    `);
    console.table(scheduleStats.recordset);

    section('Employees needing manual review');
    const review = await pool.request().query(`
      WITH wd AS (
        SELECT
          e.EmpID,
          e.EmpName,
          e.EmploymentType,
          e.PayrollMethod,
          e.SalaryType,
          COUNT(ws.ID) AS ScheduleRows,
          SUM(CASE WHEN ws.IsWorkingDay = 1 THEN 1 ELSE 0 END) AS WorkingDays
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID = e.EmpID
        WHERE ISNULL(e.isActive, 1) = 1
        GROUP BY e.EmpID, e.EmpName, e.EmploymentType, e.PayrollMethod, e.SalaryType
      )
      SELECT EmpID, EmpName, EmploymentType, PayrollMethod, SalaryType, ScheduleRows, WorkingDays,
        CASE
          WHEN WorkingDays = 7 THEN N'7 working days — verify full_time vs part_time'
          WHEN ScheduleRows = 0 THEN N'No schedule — defaulted to full_time'
          WHEN EmploymentType IS NULL OR PayrollMethod IS NULL THEN N'NULL classification'
          ELSE N'Check mapping'
        END AS ReviewReason
      FROM wd
      WHERE WorkingDays = 7
         OR ScheduleRows = 0
         OR EmploymentType IS NULL
         OR PayrollMethod IS NULL
      ORDER BY EmpName
    `);
    if (review.recordset.length === 0) {
      console.log('  ✓ No obvious manual review candidates');
    } else {
      console.table(review.recordset);
    }
  } else {
    section('TblEmpWorkSchedule');
    console.log('  Table not present — EmploymentType backfill used full_time default');
  }

  await pool.close();
  console.log('\n✅ Audit complete (read-only).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
