import { readFileSync } from 'fs';

// Load .env.local manually so this script works outside Next.js
const envPath = '.env.local';
try {
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      let value = match[2].trim();
      value = value.replace(/^["']|["']$/g, '');
      process.env[match[1]] = value;
    }
  }
} catch {
  // ignore if .env.local is missing
}

import { getPool } from '../src/lib/db';

async function main() {
  try {
    const pool = await getPool();

    console.log('=== 1. TblEmp triggers ===');
    const triggerResult = await pool.request().query(`
      SELECT
          tr.name AS TriggerName,
          tr.is_disabled,
          tr.create_date,
          tr.modify_date,
          OBJECT_DEFINITION(tr.object_id) AS TriggerDefinition
      FROM sys.triggers tr
      WHERE tr.parent_id = OBJECT_ID(N'dbo.TblEmp');
    `);
    console.dir(triggerResult.recordset, { depth: null });

    console.log('\n=== 2. Employees with midnight-crossing schedules and NULL HourlyRate ===');
    const crossingResult = await pool.request().query(`
      SELECT
          e.EmpID,
          e.EmpName,
          e.Salary,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108)  AS CheckIn,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS CheckOut,
          e.HourlyRate
      FROM dbo.TblEmp e
      WHERE e.isActive = 1
        AND e.IsPayrollEnabled = 1
        AND e.DefaultCheckInTime IS NOT NULL
        AND e.DefaultCheckOutTime IS NOT NULL
        AND e.DefaultCheckOutTime <= e.DefaultCheckInTime
        AND e.HourlyRate IS NULL
      ORDER BY e.EmpName;
    `);
    console.dir(crossingResult.recordset, { depth: null });

    console.log('\n=== 3. Employees missing scheduled times entirely ===');
    const missingResult = await pool.request().query(`
      SELECT
          e.EmpID,
          e.EmpName,
          e.IsPayrollEnabled,
          e.Salary,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108)  AS CheckIn,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS CheckOut,
          e.HourlyRate
      FROM dbo.TblEmp e
      WHERE e.isActive = 1
        AND e.IsPayrollEnabled = 1
        AND (e.DefaultCheckInTime IS NULL OR e.DefaultCheckOutTime IS NULL)
      ORDER BY e.EmpName;
    `);
    console.dir(missingResult.recordset, { depth: null });

    console.log('\n=== 4. Employees blocked from payroll (HourlyRate <= 0) ===');
    const blockedResult = await pool.request().query(`
      SELECT
          e.EmpID,
          e.EmpName,
          e.Salary,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108)  AS CheckIn,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS CheckOut,
          e.HourlyRate
      FROM dbo.TblEmp e
      WHERE e.isActive = 1
        AND e.IsPayrollEnabled = 1
        AND e.SalaryType = N'Daily'
        AND ISNULL(e.HourlyRate, 0) <= 0
      ORDER BY e.EmpName;
    `);
    console.dir(blockedResult.recordset, { depth: null });

  } catch (err) {
    console.error('Audit failed:', err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
