#!/usr/bin/env npx tsx
/**
 * Recovery/teardown after DRVO-013 two-Salon staging smoke, even on step timeout.
 * ONLY deterministic synthetic QA tenant names; NEVER CUT/production/customer tenants.
 */
import sql from 'mssql';

const DB = 'last132_agent';
const LOGIN = 'drvo_agent';

async function main() {
  const pass = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!pass) throw new Error('Missing staging-only SQL secret');
  if (process.env.DB_DATABASE === 'last132' || process.env.CLOUD_DB_NAME === 'last132') {
    throw new Error('Refuse production environment');
  }
  if (process.env.DRVO_STAGING_DB_SERVER && process.env.DRVO_STAGING_DB_SERVER !== '127.0.0.1') {
    throw new Error('Refuse nonlocal SQL endpoint');
  }
  if (process.env.DRVO_STAGING_DB_PORT && process.env.DRVO_STAGING_DB_PORT !== '14330') {
    throw new Error('Refuse non-staging tunnel port');
  }
  const pool = await sql.connect({
    server: '127.0.0.1', port: 14330, database: DB, user: LOGIN, password: pass,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 90_000,
  });
  try {
    const who = await pool.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    if (who.recordset[0]?.db !== DB || String(who.recordset[0]?.login).toLowerCase() !== LOGIN) {
      throw new Error('Staging DB identity mismatch');
    }
    const result = await pool.request().query(`
      SELECT Code, Name FROM dbo.Tenant
      WHERE Name LIKE N'DRVO013 Isolation QA %'
        AND Code LIKE N'DRVO[_][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]';
    `);
    const rows = result.recordset as Array<{ Code: string; Name: string }>;
    if (rows.length > 6) throw new Error('Unexpected number of QA tenants; manual operator review required');
    const { purgeSmokeTenant } = await import('./smokeTenantPurge');
    for (const row of rows) {
      if (!/^DRVO_[0-9A-F]{10}$/i.test(row.Code) ||
          !/^DRVO013 Isolation QA [0-9a-f]{12} [12]$/.test(row.Name)) {
        throw new Error('Unexpected tenant identity; refusing cleanup');
      }
      // A matching synthetic tenant must contain ONLY the generated QA salon branch.
      const branches = await pool.request().input('code', sql.NVarChar(64), row.Code).query(`
        SELECT b.BranchName
        FROM dbo.Tenant t JOIN dbo.Location l ON l.TenantId=t.TenantId
        JOIN dbo.TblBranch b ON b.BranchID=l.LegacyBranchId
        WHERE t.Code=@code;
      `);
      if (branches.recordset.some((b: { BranchName: string }) =>
        !String(b.BranchName).startsWith(row.Name))) {
        throw new Error('Unexpected non-QA branch under target tenant; refusing cleanup');
      }
      await purgeSmokeTenant(pool, row.Code);
      const residue = await pool.request().input('code', sql.NVarChar(64), row.Code)
        .query('SELECT COUNT(*) AS n FROM dbo.Tenant WHERE Code=@code');
      if (Number(residue.recordset[0].n) !== 0) {
        throw new Error('Synthetic tenant still present after cleanup');
      }
      console.log('PASS: staged synthetic QA tenant cleaned; no real tenant modified');
    }
    console.log('DRVO013_TWO_SALON_STAGING_CLEANUP_PASS');
  } finally {
    await pool.close().catch(() => undefined);
  }
}
void main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('DRVO013_TWO_SALON_STAGING_CLEANUP_FAIL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
