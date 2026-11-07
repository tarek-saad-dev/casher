#!/usr/bin/env npx tsx
/**
 * GitHub Actions only: read-only DRVO staging identity / migration / cleanup checks.
 * The workflow owns the SSH tunnel. This code never reads production env files.
 * Never use prod credentials; refuses any DB/login other than last132_agent/drvo_agent.
 *
 * Usage: npx tsx scripts/drvo/staging-gate-preflight.ts identity|migration9|cleanup
 */
import sql from 'mssql';

const DB_NAME = 'last132_agent';
const DB_LOGIN = 'drvo_agent';
const MIGRATION_9_SHA = 'a711f08b6e4ff2954611145120ed6d26634e55d0c67a9ecbc35bc3b792f96427';

type Action = 'identity' | 'migration9' | 'cleanup';
const accepted = ['identity', 'migration9', 'cleanup'] as const;

async function main(): Promise<void> {
  const action = process.argv[2] as Action;
  if (!accepted.includes(action)) throw new Error('Unsupported preflight action');
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing DRVO_STAGING_DB_PASSWORD');

  const pool = new sql.ConnectionPool({
    server: '127.0.0.1',
    port: 14330,
    database: DB_NAME,
    user: DB_LOGIN,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  });

  try {
    await pool.connect();
    const result = await pool.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    const row = result.recordset[0] as { db?: string; login?: string } | undefined;
    if (row?.db !== DB_NAME || String(row?.login ?? '').toLowerCase() !== DB_LOGIN) {
      throw new Error('Refusing unexpected staging database or SQL login');
    }
    console.log('DB identity:', row.db, '/', row.login);
    if (action === 'identity') return;

    if (action === 'migration9') {
      const r = await pool.request().query(
        'SELECT MigrationId, MigrationKey, Checksum, AppCommitSha ' +
        'FROM dbo.DrvoSchemaMigration WHERE MigrationId = 9'
      );
      if (r.recordset.length !== 1) throw new Error('Migration 9 ledger row missing');
      const m = r.recordset[0] as {
        MigrationKey: string; Checksum: string; AppCommitSha: string | null;
      };
      if (m.MigrationKey !== 'commercial-subscription-tenant-apps') {
        throw new Error('Unexpected migration key');
      }
      if (String(m.Checksum).toLowerCase() !== MIGRATION_9_SHA) {
        throw new Error('Migration 9 checksum mismatch');
      }
      console.log('Migration 9:', m.MigrationKey, m.Checksum, m.AppCommitSha);
      return;
    }

    const syntheticTenants = await pool.request().query(
      'SELECT COUNT(*) AS cnt FROM dbo.Tenant ' +
      "WHERE Code LIKE N'DRVO011[_]%' OR Code LIKE N'DRVO012[_]%'"
    );
    const count = Number(syntheticTenants.recordset[0]?.cnt);
    console.log('Synthetic tenant residue:', count);
    if (count !== 0) throw new Error('Synthetic DRVO011/DRVO012 tenant residue remains');

    const orphanChecks = [
      ['TenantSubscription', 'TenantId'],
      ['TenantIndustryPack', 'TenantId'],
      ['TenantAppEntitlement', 'TenantId'],
      ['PlatformOutbox', 'TenantId'],
    ] as const;
    for (const [table, column] of orphanChecks) {
      const q = 'SELECT COUNT(*) AS cnt FROM dbo.[' + table + '] x ' +
        'WHERE NOT EXISTS (SELECT 1 FROM dbo.Tenant t WHERE t.TenantId = x.[' + column + '])';
      const r = await pool.request().query(q);
      const orphans = Number(r.recordset[0]?.cnt);
      console.log(table, 'orphan rows:', orphans);
      if (orphans !== 0) throw new Error(table + ' has orphan rows');
    }
    console.log('DRVO staging cleanup proof: PASS');
  } finally {
    if (pool.connected) await pool.close();
  }
}

main().catch(error => {
  console.error('DRVO staging preflight:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
