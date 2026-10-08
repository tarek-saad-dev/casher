#!/usr/bin/env npx tsx
/**
 * DRVO-015 read-only verification — last132_agent / drvo_agent only.
 * Migration 10 schema verify, NULL TenantId counts and master-data ownership per tenant.
 * Never loads .env.local. Requires DRVO_STAGING_DB_PASSWORD. Writes nothing.
 */
import sql from 'mssql';
import { verifyMasterDataTenancySchema, verifyNoNullMasterDataTenant } from './migrations/010-master-data-tenancy';
import { MASTER_DATA_TENANT_TABLES } from '../../src/platform/masterData/tables';

const STAGING_DB = 'last132_agent';
const STAGING_LOGIN = 'drvo_agent';

async function main() {
  const password = process.env.DRVO_STAGING_DB_PASSWORD || '';
  if (!password) {
    console.error('Missing DRVO_STAGING_DB_PASSWORD (staging only; .env.local is never read).');
    process.exit(1);
  }
  const pool = await sql.connect({
    server: process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1',
    port: parseInt(process.env.DRVO_STAGING_DB_PORT || '14330', 10),
    database: STAGING_DB,
    user: STAGING_LOGIN,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 120000,
  });
  try {
    const live = await pool.request().query(`SELECT DB_NAME() AS db, SUSER_SNAME() AS login;`);
    const db = String(live.recordset[0].db);
    const login = String(live.recordset[0].login).toLowerCase();
    if (db !== STAGING_DB || login !== STAGING_LOGIN) {
      throw new Error(`Refusing: expected ${STAGING_DB} as ${STAGING_LOGIN}, got ${db} as ${login}`);
    }

    const nulls = await verifyNoNullMasterDataTenant(pool);
    console.log('NULL TenantId per table:', JSON.stringify(nulls.nullCounts));

    for (const table of MASTER_DATA_TENANT_TABLES) {
      if (nulls.nullCounts[table] < 0) continue;
      const r = await pool.request().query(`
        SELECT t.Code, COUNT_BIG(*) AS n
        FROM dbo.${table} x WITH (NOLOCK)
        JOIN dbo.Tenant t WITH (NOLOCK) ON t.TenantId = x.TenantId
        GROUP BY t.Code ORDER BY t.Code;
      `);
      const owners = (r.recordset as Array<{ Code: string; n: number }>).map((o) => `${o.Code}=${o.n}`).join(' ');
      console.log(`  ${table}: ${owners || '(empty)'}`);
    }

    const report = await verifyMasterDataTenancySchema(pool);
    if (!report.ok) {
      console.error('DRVO-015 verify FAIL:\n  ' + report.failures.join('\n  '));
      process.exit(1);
    }
    console.log('DRVO-015 verify PASS');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('DRVO-015 verify FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
