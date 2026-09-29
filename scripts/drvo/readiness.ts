import type { ConnectionPool } from 'mssql';
import {
  DRVO_MODULE_REQUIRED_MIGRATIONS,
  DRVO_MIGRATIONS,
  assertDrvoMigrationManifestValid,
} from './migrations/index';
import { verifyPlatformBootstrap } from './platformBootstrap';
import { listAppliedDrvoMigrations } from './registry';
import type { DrvoModuleReadinessReport, DrvoReadinessCheck } from './types';

export type DrvoVerifyReport = {
  database: string;
  migrations: {
    ok: boolean;
    applied: string[];
    pending: string[];
    checksumMismatches: string[];
  };
  platformCore: Awaited<ReturnType<typeof verifyPlatformBootstrap>>;
  modules: DrvoModuleReadinessReport[];
  ok: boolean;
  failures: string[];
};

async function treasuryReady(pool: ConnectionPool): Promise<DrvoReadinessCheck> {
  const check = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NULL THEN 0 ELSE 1 END AS registry,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL THEN 0 ELSE 1 END AS reversalOf,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL THEN 0 ELSE 1 END AS isReversed;
  `);
  const row = check.recordset[0];
  const ok =
    !!row &&
    Number(row.registry) === 1 &&
    Number(row.reversalOf) === 1 &&
    Number(row.isReversed) === 1;
  return {
    id: 'treasury.schema',
    ok,
    detail: ok ? 'TreasuryMovementRegistry ready' : 'Treasury schema incomplete',
  };
}

function migrationKeysApplied(
  appliedKeys: Set<string>,
  required: string[],
): DrvoReadinessCheck[] {
  return required.map((key) => ({
    id: `migration.${key}`,
    ok: appliedKeys.has(key),
    detail: appliedKeys.has(key) ? 'applied' : 'pending',
  }));
}

async function loadRolloutMeta(module: string): Promise<{
  rollout: 'legacy' | 'extracted';
  activationRequired: boolean;
}> {
  try {
    const { getDrvoModuleRolloutSpec } = await import(
      '../../src/platform/drvo/moduleManifest'
    );
    const spec = getDrvoModuleRolloutSpec(module);
    return {
      rollout: spec.rollout,
      activationRequired: spec.rollout === 'extracted',
    };
  } catch {
    return { rollout: 'legacy', activationRequired: false };
  }
}

export async function verifyDrvoReadiness(
  pool: ConnectionPool,
  module?: string,
): Promise<DrvoModuleReadinessReport> {
  assertDrvoMigrationManifestValid();
  const required = DRVO_MODULE_REQUIRED_MIGRATIONS[module ?? ''];
  if (!required) {
    throw new Error(`Unknown DRVO module: ${module}`);
  }
  const applied = await listAppliedDrvoMigrations(pool);
  const appliedKeys = new Set(applied.map((r) => r.MigrationKey));
  const checks: DrvoReadinessCheck[] = migrationKeysApplied(appliedKeys, required);

  if (module === 'booking' || module === 'queue' || module === 'operational-calendar') {
    const bootstrap = await verifyPlatformBootstrap(pool);
    checks.push({
      id: 'platform.bootstrap',
      ok: bootstrap.ok,
      detail: bootstrap.ok ? 'CASHER_BOOT ready' : bootstrap.failures.join('; '),
    });
  }

  if (module === 'treasury') {
    checks.push(await treasuryReady(pool));
    const bootstrap = await verifyPlatformBootstrap(pool);
    checks.push({
      id: 'platform.bootstrap',
      ok: bootstrap.ok,
      detail: bootstrap.ok ? 'CASHER_BOOT ready' : bootstrap.failures.join('; '),
    });
  }

  const ok = checks.every((c) => c.ok);
  const meta = module ? await loadRolloutMeta(module) : { rollout: 'legacy' as const, activationRequired: false };
  return {
    module: module ?? '',
    ok,
    checks,
    requiredMigrationKeys: required,
    rollout: meta.rollout,
    activationRequired: meta.activationRequired,
  };
}

export async function verifyDrvoSystem(pool: ConnectionPool): Promise<DrvoVerifyReport> {
  assertDrvoMigrationManifestValid();
  const dbResult = await pool.request().query(`SELECT DB_NAME() AS db;`);
  const database = String(dbResult.recordset[0]?.db ?? '');

  const appliedRows = await listAppliedDrvoMigrations(pool);
  const appliedKeys = new Set(appliedRows.map((r) => r.MigrationKey));
  const checksumMismatches: string[] = [];
  for (const row of appliedRows) {
    const def = DRVO_MIGRATIONS.find((m) => m.migrationKey === row.MigrationKey);
    if (def && def.checksum !== row.Checksum) {
      checksumMismatches.push(row.MigrationKey);
    }
  }

  const pending = DRVO_MIGRATIONS.map((m) => m.migrationKey).filter((k) => !appliedKeys.has(k));
  const platformCore = await verifyPlatformBootstrap(pool);

  const moduleNames = Object.keys(DRVO_MODULE_REQUIRED_MIGRATIONS).filter(
    (m) => m !== 'platform-core',
  );
  const modules: DrvoModuleReadinessReport[] = [];
  for (const name of moduleNames) {
    modules.push(await verifyDrvoReadiness(pool, name));
  }

  const failures: string[] = [];
  if (checksumMismatches.length) {
    failures.push(`Checksum mismatch: ${checksumMismatches.join(', ')}`);
  }
  if (pending.length) {
    failures.push(`Pending migrations: ${pending.join(', ')}`);
  }
  if (!platformCore.ok) {
    failures.push(...platformCore.failures);
  }
  for (const mod of modules) {
    if (!mod.ok) {
      const failedChecks = mod.checks.filter((c) => !c.ok).map((c) => c.id).join(', ');
      if (mod.activationRequired) {
        failures.push(
          `REFUSING extracted activation for ${mod.module}: readiness failed (${failedChecks})`,
        );
      } else {
        failures.push(`${mod.module}: ${failedChecks}`);
      }
    }
  }

  return {
    database,
    migrations: {
      ok: pending.length === 0 && checksumMismatches.length === 0,
      applied: [...appliedKeys],
      pending,
      checksumMismatches,
    },
    platformCore,
    modules,
    ok: failures.length === 0,
    failures,
  };
}
