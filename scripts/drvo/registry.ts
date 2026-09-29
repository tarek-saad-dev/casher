import path from 'path';
import type { ConnectionPool } from 'mssql';
import sql from 'mssql';
import { executeSqlFile } from './sqlBatch';
import type { AppliedDrvoMigrationRow } from './types';

const REGISTRY_SQL = path.join(
  __dirname,
  '..',
  '..',
  'db',
  'drvo-migrations',
  '000-registry',
  'schema.sql',
);

export async function ensureDrvoMigrationRegistryTable(pool: ConnectionPool): Promise<void> {
  await executeSqlFile(pool, REGISTRY_SQL);
}

export async function listAppliedDrvoMigrations(
  pool: ConnectionPool,
): Promise<AppliedDrvoMigrationRow[]> {
  const hasTable = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.DrvoSchemaMigration', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(hasTable.recordset[0]?.ok) !== 1) return [];
  const result = await pool.request().query(`
    SELECT MigrationId, MigrationKey, Name, Checksum, AppliedAtUtc, AppCommitSha, ExecutionMs
    FROM dbo.DrvoSchemaMigration WITH (NOLOCK)
    ORDER BY MigrationId;
  `);
  return result.recordset as AppliedDrvoMigrationRow[];
}

export async function recordDrvoMigration(
  pool: ConnectionPool,
  input: {
    migrationId: number;
    migrationKey: string;
    name: string;
    checksum: string;
    appCommitSha: string | null;
    executionMs: number;
  },
): Promise<void> {
  await new sql.Request(pool)
    .input('migrationId', sql.Int, input.migrationId)
    .input('migrationKey', sql.NVarChar(64), input.migrationKey)
    .input('name', sql.NVarChar(256), input.name)
    .input('checksum', sql.NVarChar(64), input.checksum)
    .input('appCommitSha', sql.NVarChar(64), input.appCommitSha)
    .input('executionMs', sql.Int, input.executionMs)
    .query(`
      INSERT INTO dbo.DrvoSchemaMigration (
        MigrationId, MigrationKey, Name, Checksum, AppliedAtUtc, AppCommitSha, ExecutionMs
      )
      VALUES (
        @migrationId, @migrationKey, @name, @checksum, SYSUTCDATETIME(), @appCommitSha, @executionMs
      );
    `);
}
