#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * Phase 4B.1 — Daily Payroll HR model diagnostic runner (READ-ONLY).
 * Invoked by scripts/audit-daily-payroll-hr-model.js
 */

import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';
import {
  buildDailyPayrollAuditReport,
  formatAuditTableRow,
  READ_ONLY_GUARD,
} from '../src/lib/payroll/dailyPayrollHrAudit';
import { PAYROLL_VALIDATION_REASON_LABELS } from '../src/lib/payroll/dailyPayrollHrRules';

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
  requestTimeout: 60000,
};

function parseArgs(argv: string[]) {
  let date: string | null = null;
  let empId: number | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--date=')) {
      date = arg.slice('--date='.length);
    } else if (arg.startsWith('--empId=')) {
      empId = parseInt(arg.slice('--empId='.length), 10);
    }
  }

  return { date, empId };
}

function section(title: string) {
  console.log('\n' + '═'.repeat(70));
  console.log(title);
  console.log('═'.repeat(70));
}

function assertReadOnly() {
  if (READ_ONLY_GUARD.allowWrites || READ_ONLY_GUARD.allowGenerate || READ_ONLY_GUARD.allowLedger) {
    throw new Error('Audit aborted: write guard must remain disabled');
  }
}

async function fetchEmployees(pool: sql.ConnectionPool, dayOfWeek: number, empId?: number) {
  const req = pool.request().input('dayOfWeek', sql.TinyInt, dayOfWeek);
  if (empId != null) req.input('empId', sql.Int, empId);

  const result = await req.query(`
    SELECT
      e.EmpID,
      e.EmpName,
      e.isActive,
      e.IsPayrollEnabled,
      e.IsAttendanceExempt,
      e.EmploymentType,
      e.PayrollMethod,
      e.DayOffPolicy,
      e.SalaryType,
      e.ManualHourlyRate,
      e.HourlyRate,
      e.DailyRate,
      e.BaseSalary,
      e.Salary,
      CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefaultCheckInTime,
      CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
      ws.DayOfWeek AS ScheduleDayOfWeek,
      ws.IsWorkingDay,
      CONVERT(VARCHAR(5), ws.StartTime, 108) AS ScheduleStartTime,
      CONVERT(VARCHAR(5), ws.EndTime, 108) AS ScheduleEndTime
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmpWorkSchedule ws
      ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
    WHERE ISNULL(e.isActive, 1) = 1
      ${empId != null ? 'AND e.EmpID = @empId' : ''}
    ORDER BY e.EmpName
  `);

  return result.recordset;
}

async function fetchAttendance(pool: sql.ConnectionPool, workDate: string, empId?: number) {
  const req = pool.request().input('workDate', sql.Date, workDate);
  if (empId != null) req.input('empId', sql.Int, empId);

  const result = await req.query(`
    SELECT
      a.EmpID,
      a.Status,
      CONVERT(VARCHAR(5), a.CheckInTime, 108) AS CheckInTime,
      CONVERT(VARCHAR(5), a.CheckOutTime, 108) AS CheckOutTime
    FROM dbo.TblEmpAttendance a
    WHERE a.WorkDate = @workDate
      ${empId != null ? 'AND a.EmpID = @empId' : ''}
  `);

  return result.recordset;
}

async function main() {
  assertReadOnly();

  const { date, empId } = parseArgs(process.argv.slice(2));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: node scripts/audit-daily-payroll-hr-model.js --date=YYYY-MM-DD [--empId=N]');
    process.exit(1);
  }

  if (!config.server || !config.user) {
    console.error('Missing DB credentials in .env / .env.local');
    process.exit(1);
  }

  const dayOfWeek = new Date(`${date}T12:00:00Z`).getDay();

  console.log('Daily Payroll HR Model Diagnostic (READ-ONLY)');
  console.log('Date:', date, '| DayOfWeek:', dayOfWeek);
  console.log('Database:', config.database, '@', config.server);
  if (empId != null) console.log('Filter EmpID:', empId);
  console.log('Guards: writes=OFF generate=OFF ledger=OFF');

  const pool = await sql.connect(config);

  try {
    const employees = await fetchEmployees(pool, dayOfWeek, empId);
    const attendances = await fetchAttendance(pool, date, empId);

    const { rows, summary } = buildDailyPayrollAuditReport(
      employees,
      attendances,
      date,
      empId,
    );

    section('Per-employee audit');
    if (rows.length === 0) {
      console.log('  (no employees matched)');
    } else {
      console.table(rows.map(formatAuditTableRow));
    }

    section('Summary');
    console.table([{
      date: summary.date,
      total: summary.totalEmployees,
      eligible: summary.eligibleCount,
      excluded: summary.excludedCount,
      errors: summary.errorCount,
      expectedTotalWage: summary.expectedTotalDailyWage.toFixed(2),
      hourlyTotal: summary.expectedHourlyTotal.toFixed(2),
      dailyRateTotal: summary.expectedDailyRateTotal.toFixed(2),
      monthlyExcluded: summary.monthlyExcludedCount,
      freelanceExcluded: summary.freelanceExcludedCount,
    }]);

    section('Highlights');
    if (summary.highlights.length === 0) {
      console.log('  (none)');
    } else {
      for (const h of summary.highlights) console.log('  •', h);
    }

    const errors = rows.filter((r) => r.eligibilityStatus === 'error');
    if (errors.length > 0) {
      section('Errors (must fix before generate)');
      for (const r of errors) {
        const label = r.reason ? PAYROLL_VALIDATION_REASON_LABELS[r.reason] : r.reason;
        console.log(`  ${r.EmpName} (${r.EmpID}): ${label}`);
      }
    }

    const excluded = rows.filter((r) => r.eligibilityStatus === 'excluded');
    if (excluded.length > 0) {
      section('Excluded (not errors)');
      for (const r of excluded) {
        const label = r.reason ? PAYROLL_VALIDATION_REASON_LABELS[r.reason] : r.reason;
        console.log(`  ${r.EmpName} (${r.EmpID}): ${label}`);
      }
    }

    const eligible = rows.filter((r) => r.eligibilityStatus === 'eligible');
    if (eligible.length > 0) {
      section('Eligible expected wages');
      console.table(
        eligible.map((r) => ({
          EmpID: r.EmpID,
          EmpName: r.EmpName,
          Method: r.PayrollMethod,
          Hrs: r.actualHours,
          Rate: r.effectiveHourlyRate ?? r.DailyRate,
          ExpectedWage: r.expectedDailyWage,
        })),
      );
    }

    console.log('\n✅ Audit complete (read-only — no data modified).');
  } finally {
    await pool.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
