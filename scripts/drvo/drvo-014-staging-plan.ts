#!/usr/bin/env npx tsx
/**
 * DRVO Clinics read-only migration inventory for the isolated VPS staging checkout.
 * This script does not load dotenv, create tables, or apply migrations.
 */
import { existsSync } from 'node:fs';
import sql from 'mssql';
import { DRVO_MIGRATIONS, assertDrvoMigrationManifestValid } from './migrations/index';
import { isAcceptedChecksum } from './checksum';

async function main() {
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (existsSync(file)) throw new Error(`Refusing staging plan from checkout containing ${file}`);
  }
  const password = process.env.DRVO_STAGING_DB_PASSWORD;
  if (!password) throw new Error('Missing DRVO_STAGING_DB_PASSWORD');
  const host = process.env.DRVO_STAGING_DB_SERVER || '127.0.0.1';
  const port = Number(process.env.DRVO_STAGING_DB_PORT || '1433');
  if (host !== '127.0.0.1' || ![1433, 14330].includes(port)) {
    throw new Error('Staging plan only supports the VPS loopback listener or dedicated SSH tunnel');
  }

  assertDrvoMigrationManifestValid();
  const pool = await new sql.ConnectionPool({
    server: host,
    port,
    database: 'last132_agent',
    user: 'drvo_agent',
    password,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 10000,
    requestTimeout: 15000,
  }).connect();

  try {
    const identity = (await pool.request().query(
      "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, HAS_DBACCESS(N'last132') AS productionAccess;",
    )).recordset[0];
    if (identity.db !== 'last132_agent' ||
        String(identity.login).toLowerCase() !== 'drvo_agent' ||
        identity.productionAccess !== 0) {
      throw new Error('REFUSED: staging DB/login/production-access isolation check failed');
    }

    const exists = (await pool.request().query(
      "SELECT OBJECT_ID(N'dbo.DrvoSchemaMigration', N'U') AS objectId;",
    )).recordset[0]?.objectId;
    if (!exists) throw new Error('Migration ledger missing; stop and review staging bootstrap before applying anything');

    const rows = (await pool.request().query(
      'SELECT MigrationId, MigrationKey, Checksum FROM dbo.DrvoSchemaMigration ORDER BY MigrationId;',
    )).recordset as Array<{ MigrationId: number; MigrationKey: string; Checksum: string }>;
    const applied = new Map(rows.map(row => [row.MigrationKey, row]));
    const plan = DRVO_MIGRATIONS.map(migration => {
      const row = applied.get(migration.migrationKey);
      const checksumOk = !row || (Number(row.MigrationId) === migration.migrationId &&
        isAcceptedChecksum(migration, String(row.Checksum)));
      return {
        id: migration.migrationId,
        key: migration.migrationKey,
        status: !row ? 'PENDING' : checksumOk ? 'APPLIED' : 'MISMATCH',
        risk: migration.control.risk,
        requiresBackup: migration.control.requiresBackup,
        dependencies: migration.dependencies,
      };
    });
    const unexpected = rows.filter(row => !DRVO_MIGRATIONS.some(m => m.migrationKey === row.MigrationKey));
    const mismatch = plan.filter(m => m.status === 'MISMATCH');
    console.log(JSON.stringify({
      database: 'last132_agent',
      login: 'drvo_agent',
      productionAccess: 0,
      mode: 'READ_ONLY',
      plan,
      unexpectedApplied: unexpected.map(row => ({ id: row.MigrationId, key: row.MigrationKey })),
      readyForMigrationReview: mismatch.length === 0 && unexpected.length === 0,
    }, null, 2));
    if (mismatch.length || unexpected.length) throw new Error('Staging migration inventory mismatch; no apply allowed');
  } finally {
    await pool.close();
  }
}

main().catch(err => {
  console.error('STAGING_PLAN_FAIL:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
