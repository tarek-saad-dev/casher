import type { ConnectionPool } from 'mssql';
import {
  assertDrvoMigrationManifestValid,
  DRVO_MIGRATIONS,
} from './migrations/index';
import {
  ensureDrvoMigrationRegistryTable,
  listAppliedDrvoMigrations,
  recordDrvoMigration,
} from './registry';
import type {
  AppliedDrvoMigrationRow,
  DrvoMigrationContext,
  DrvoMigrationDefinition,
  DrvoMigrationRunReport,
} from './types';
import { PRODUCTION_DB, STAGING_DB } from './types';

export type RunDrvoMigrationsOptions = {
  allowProduction: boolean;
  expectedDatabase?: string;
  appCommitSha?: string | null;
};

export type DrvoRegistryPort = {
  ensure: () => Promise<void>;
  list: () => Promise<AppliedDrvoMigrationRow[]>;
  record: (input: {
    migrationId: number;
    migrationKey: string;
    name: string;
    checksum: string;
    appCommitSha: string | null;
    executionMs: number;
  }) => Promise<void>;
};

export async function assertDatabaseAllowed(
  pool: ConnectionPool,
  opts: RunDrvoMigrationsOptions,
): Promise<string> {
  const result = await pool.request().query(`SELECT DB_NAME() AS db;`);
  const live = String(result.recordset[0]?.db ?? '');

  if (live === PRODUCTION_DB) {
    if (!opts.allowProduction) {
      throw new Error(
        `Refusing production database ${PRODUCTION_DB} without --allow-production.`,
      );
    }
    return live;
  }

  if (opts.expectedDatabase && live !== opts.expectedDatabase) {
    throw new Error(
      `Refusing: DB_NAME()="${live}" does not match expected "${opts.expectedDatabase}".`,
    );
  }

  return live;
}

function sqlRegistryPort(pool: ConnectionPool): DrvoRegistryPort {
  return {
    ensure: () => ensureDrvoMigrationRegistryTable(pool),
    list: () => listAppliedDrvoMigrations(pool),
    record: (input) => recordDrvoMigration(pool, input),
  };
}

/**
 * Core migration runner — injectable registry + migration list for unit tests.
 */
export async function runDrvoMigrationsCore(args: {
  pool: ConnectionPool;
  migrations: DrvoMigrationDefinition[];
  registry: DrvoRegistryPort;
  opts: RunDrvoMigrationsOptions;
  databaseName?: string;
}): Promise<DrvoMigrationRunReport> {
  const { pool, migrations, registry, opts } = args;
  const database = args.databaseName ?? (await assertDatabaseAllowed(pool, opts));
  await registry.ensure();

  const appliedRows = await registry.list();
  const appliedByKey = new Map(appliedRows.map((r) => [r.MigrationKey, r]));

  const report: DrvoMigrationRunReport = {
    database,
    applied: [],
    skipped: [],
    baselined: [],
    ok: true,
    failures: [],
  };

  const ctx: DrvoMigrationContext = {
    pool,
    database,
    appCommitSha: opts.appCommitSha ?? null,
  };

  for (const migration of migrations) {
    const existing = appliedByKey.get(migration.migrationKey);
    if (existing) {
      if (existing.Checksum !== migration.checksum) {
        throw new Error(
          `DRVO migration checksum mismatch for ${migration.migrationKey}: ` +
            `applied=${existing.Checksum} current=${migration.checksum}. ` +
            `Released migrations are immutable.`,
        );
      }
      report.skipped.push(migration.migrationKey);
      continue;
    }

    for (const dep of migration.dependencies) {
      if (!appliedByKey.has(dep)) {
        throw new Error(
          `Migration ${migration.migrationKey} requires ${dep} but it is not applied.`,
        );
      }
    }

    const started = Date.now();
    let baselined = false;

    if (migration.reconcileBaseline) {
      baselined = await migration.reconcileBaseline(ctx);
    }

    if (!baselined) {
      try {
        await migration.apply(ctx);
      } catch (err) {
        report.ok = false;
        report.failures.push(
          `${migration.migrationKey}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }

    const verify = await migration.verify(ctx);
    if (!verify.ok) {
      report.ok = false;
      report.failures.push(`${migration.migrationKey}: ${verify.failures.join('; ')}`);
      throw new Error(
        `DRVO migration verify failed for ${migration.migrationKey}: ${verify.failures.join('; ')}`,
      );
    }

    const executionMs = Date.now() - started;
    await registry.record({
      migrationId: migration.migrationId,
      migrationKey: migration.migrationKey,
      name: migration.name,
      checksum: migration.checksum,
      appCommitSha: ctx.appCommitSha,
      executionMs,
    });

    appliedByKey.set(migration.migrationKey, {
      MigrationId: migration.migrationId,
      MigrationKey: migration.migrationKey,
      Name: migration.name,
      Checksum: migration.checksum,
      AppliedAtUtc: new Date(),
      AppCommitSha: ctx.appCommitSha,
      ExecutionMs: executionMs,
    });

    if (baselined) report.baselined.push(migration.migrationKey);
    else report.applied.push(migration.migrationKey);
  }

  return report;
}

export async function runDrvoMigrations(
  pool: ConnectionPool,
  opts: RunDrvoMigrationsOptions,
): Promise<DrvoMigrationRunReport> {
  assertDrvoMigrationManifestValid();
  return runDrvoMigrationsCore({
    pool,
    migrations: DRVO_MIGRATIONS,
    registry: sqlRegistryPort(pool),
    opts,
  });
}

export { PRODUCTION_DB, STAGING_DB };
