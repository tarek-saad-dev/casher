/**
 * Turn off booking eligibility for non-barber employees (e.g. cashiers)
 * that still have CanReceiveBookings=1 on a branch assignment.
 *
 *   npx tsx scripts/fix-non-barber-can-receive-bookings.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import sql from 'mssql';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

function buildConfig(): sql.config {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || 'HawaiRestaurant',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.CLOUD_DB_ENCRYPT !== 'false' && process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
  };
}

async function main() {
  const cfg = buildConfig();
  console.log(`[fix-non-barber-bookings] connecting to ${cfg.server} / ${cfg.database}`);
  const pool = await sql.connect(cfg);

  const before = await pool.request().query(`
    SELECT ea.ID, ea.EmpID, e.EmpName, e.Job, ea.BranchID, b.BranchCode, ea.CanReceiveBookings
    FROM dbo.TblEmpBranchAssignment ea
    INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
    INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
    WHERE ea.IsActive = 1
      AND ea.CanReceiveBookings = 1
      AND (
        e.Job IS NULL
        OR LTRIM(RTRIM(e.Job)) = N''
        OR e.Job NOT IN (N'حلاق', N'مساعد', N'Barber', N'barber')
      )
    ORDER BY e.EmpName, b.BranchCode
  `);

  console.log('Non-barbers with CanReceiveBookings=1 before fix:');
  console.log(JSON.stringify(before.recordset, null, 2));

  const result = await pool.request().query(`
    UPDATE ea
    SET CanReceiveBookings = 0,
        UpdatedAt = SYSUTCDATETIME()
    FROM dbo.TblEmpBranchAssignment ea
    INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
    WHERE ea.IsActive = 1
      AND ea.CanReceiveBookings = 1
      AND (
        e.Job IS NULL
        OR LTRIM(RTRIM(e.Job)) = N''
        OR e.Job NOT IN (N'حلاق', N'مساعد', N'Barber', N'barber')
      )
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        updatedRows: Number(result.rowsAffected?.[0] ?? 0),
        fixedEmployees: before.recordset.map(
          (r: { EmpID: number; EmpName: string; Job: string; BranchCode: string }) => ({
            empId: r.EmpID,
            name: r.EmpName,
            job: r.Job,
            branch: r.BranchCode,
          }),
        ),
      },
      null,
      2,
    ),
  );

  await pool.close();
}

main().catch((err) => {
  console.error('[fix-non-barber-bookings] failed:', err);
  process.exit(1);
});
