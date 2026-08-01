/**
 * Idempotent: set CanViewReports=1 for all partner-role users on active branch links.
 *
 *   npx tsx scripts/fix-partner-report-access.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import sql from 'mssql';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

function buildConfig(): sql.config {
  const useCloud =
    process.env.USE_CLOUD_DB === 'true' ||
    Boolean(process.env.CLOUD_DB_SERVER || process.env.DB_SERVER);

  if (useCloud && (process.env.CLOUD_DB_SERVER || process.env.DB_SERVER)) {
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

  return {
    server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || 'localhost',
    database:
      process.env.LOCAL_DB_NAME ||
      process.env.DB_DATABASE ||
      process.env.DB_NAME ||
      'HawaiDB',
    user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
    password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.LOCAL_DB_ENCRYPT === 'true' || false,
      trustServerCertificate:
        process.env.LOCAL_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' ||
        true,
    },
  };
}

async function main() {
  const cfg = buildConfig();
  console.log(`[fix-partner-report-access] connecting to ${cfg.server} / ${cfg.database}`);
  const pool = await sql.connect(cfg);

  const before = await pool.request().query(`
    SELECT COUNT(*) AS Cnt
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
    INNER JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
    INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.RoleKey = N'partner'
    WHERE ISNULL(u.isDeleted, 0) = 0
      AND uba.IsActive = 1
      AND uba.CanViewReports = 0
  `);

  const result = await pool.request().query(`
    UPDATE uba
    SET CanViewReports = 1,
        UpdatedAt = SYSUTCDATETIME(),
        GrantReason = CASE
          WHEN uba.GrantReason IS NULL OR LTRIM(RTRIM(uba.GrantReason)) = N''
            THEN N'partner-role-report-access'
          WHEN uba.GrantReason LIKE N'%partner-role-report-access%'
            THEN uba.GrantReason
          ELSE uba.GrantReason + N';partner-role-report-access'
        END
    FROM dbo.TblUserBranchAccess uba
    INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
    INNER JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
    INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.RoleKey = N'partner'
    WHERE ISNULL(u.isDeleted, 0) = 0
      AND uba.IsActive = 1
      AND uba.CanViewReports = 0
  `);

  const after = await pool.request().query(`
    SELECT u.UserID, u.UserName, u.loginName,
           b.BranchCode, uba.IsDefault, uba.CanViewReports, uba.IsActive
    FROM dbo.TblUser u
    INNER JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
    INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.RoleKey = N'partner'
    LEFT JOIN dbo.TblUserBranchAccess uba ON uba.UserID = u.UserID AND uba.IsActive = 1
    LEFT JOIN dbo.TblBranch b ON b.BranchID = uba.BranchID
    WHERE ISNULL(u.isDeleted, 0) = 0
    ORDER BY u.UserName, b.BranchCode
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        needingFixBefore: Number(before.recordset[0].Cnt),
        updatedAccessRows: Number(result.rowsAffected?.[0] ?? 0),
        partners: after.recordset,
      },
      null,
      2,
    ),
  );

  await pool.close();
}

main().catch((err) => {
  console.error('[fix-partner-report-access] failed:', err);
  process.exit(1);
});
