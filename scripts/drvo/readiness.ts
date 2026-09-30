import type { ConnectionPool } from 'mssql';
import {
  getDrvoModuleRequiredMigrations,
  DRVO_MIGRATIONS,
  assertDrvoMigrationManifestValid,
} from './migrations/index';
import { verifyPlatformBootstrap } from './platformBootstrap';
import { verifyPlatformCoreStructure } from './platformCoreSchema';
import { verifyTreasuryMovementSchema } from './migrations/006-treasury-movement-registry';
import { verifyInsCashMoveSalesGuard } from './migrations/008-ins-cash-move-sales-guard';
import { listAppliedDrvoMigrations } from './registry';
import type { DrvoModuleReadinessReport, DrvoReadinessCheck } from './types';
import {
  assertAllDrvoRolloutContracts,
  DRVO_MODULE_ROLLOUT,
  getDrvoModuleRolloutSpec,
  type DrvoModuleRolloutSpec,
} from '../../src/platform/drvo/moduleManifest';

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

/**
 * Fail-closed validation of moduleManifest against migration keys.
 * Throws on any inconsistency — never silently downgrades to legacy.
 */
export function assertDrvoDeployManifestConsistent(): void {
  assertDrvoMigrationManifestValid();
  assertAllDrvoRolloutContracts();

  const migrationKeys = new Set(DRVO_MIGRATIONS.map((m) => m.migrationKey));
  const moduleKeys = new Set(DRVO_MODULE_ROLLOUT.map((m) => m.module));
  moduleKeys.add('platform-core');

  const requiredMap = getDrvoModuleRequiredMigrations();
  for (const [mod, keys] of Object.entries(requiredMap)) {
    if (!moduleKeys.has(mod) && mod !== 'platform-core') {
      throw new Error(`Required-migrations map has unknown module "${mod}"`);
    }
    for (const key of keys) {
      if (!migrationKeys.has(key)) {
        throw new Error(`Module "${mod}" requires unknown migration key "${key}"`);
      }
    }
  }

  for (const spec of DRVO_MODULE_ROLLOUT) {
    for (const dep of spec.dependencies) {
      if (dep !== 'platform-core' && !moduleKeys.has(dep)) {
        throw new Error(
          `Module "${spec.module}" depends on unknown module "${dep}"`,
        );
      }
    }
    for (const key of spec.requiredMigrationKeys) {
      if (!migrationKeys.has(key)) {
        throw new Error(
          `Module "${spec.module}" requiredMigrationKeys includes unknown "${key}"`,
        );
      }
    }
    if (!spec.readinessCheckIds.length) {
      throw new Error(`Module "${spec.module}" must declare readinessCheckIds`);
    }
  }
}

export async function verifyDrvoReadiness(
  pool: ConnectionPool,
  module: string,
): Promise<DrvoModuleReadinessReport> {
  assertDrvoDeployManifestConsistent();
  const requiredMap = getDrvoModuleRequiredMigrations();
  const required = requiredMap[module];
  if (!required) {
    throw new Error(`Unknown DRVO module: ${module}`);
  }

  const spec: DrvoModuleRolloutSpec | null =
    module === 'platform-core' ? null : getDrvoModuleRolloutSpec(module);

  const applied = await listAppliedDrvoMigrations(pool);
  const appliedKeys = new Set(applied.map((r) => r.MigrationKey));
  const checks: DrvoReadinessCheck[] = migrationKeysApplied(appliedKeys, required);

  const structure = await verifyPlatformCoreStructure(pool);
  checks.push({
    id: 'platform.core.structure',
    ok: structure.ok,
    detail: structure.ok ? 'Platform Core structure OK' : structure.failures.join('; '),
  });

  if (
    module === 'booking' ||
    module === 'queue' ||
    module === 'operational-calendar' ||
    module === 'treasury' ||
    module === 'pos' ||
    module === 'pos-sale-treasury' ||
    module === 'platform-core'
  ) {
    const bootstrap = await verifyPlatformBootstrap(pool);
    checks.push({
      id: 'platform.bootstrap',
      ok: bootstrap.ok,
      detail: bootstrap.ok ? 'CASHER_BOOT ready' : bootstrap.failures.join('; '),
    });
  }

  if (module === 'treasury' || module === 'pos-sale-treasury') {
    const treasury = await verifyTreasuryMovementSchema(pool);
    checks.push({
      id: 'treasury.schema',
      ok: treasury.ok,
      detail: treasury.ok ? 'TreasuryMovementRegistry ready' : treasury.failures.join('; '),
    });
  }

  if (module === 'pos-sale-treasury') {
    const guard = await verifyInsCashMoveSalesGuard(pool);
    checks.push({
      id: 'treasury.sale-trigger-guard',
      ok: guard.ok,
      detail: guard.ok ? 'InsCashMoveSales coexistence guard ready' : guard.failures.join('; '),
    });
  }

  if (spec) {
    const produced = new Set(checks.map((c) => c.id));
    for (const expected of spec.readinessCheckIds) {
      if (!produced.has(expected)) {
        checks.push({
          id: expected,
          ok: false,
          detail: `Declared readinessCheckId "${expected}" was not produced by verify`,
        });
      }
    }
  }

  const ok = checks.every((c) => c.ok);
  const rollout = spec?.rollout ?? 'extracted';
  const activationRequired = rollout === 'extracted';

  return {
    module,
    ok,
    checks,
    requiredMigrationKeys: required,
    rollout,
    activationRequired,
  };
}

export async function verifyDrvoSystem(pool: ConnectionPool): Promise<DrvoVerifyReport> {
  // Fail closed on invalid DRVO metadata before any DB work is trusted.
  assertDrvoDeployManifestConsistent();

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

  const modules: DrvoModuleReadinessReport[] = [];
  for (const spec of DRVO_MODULE_ROLLOUT) {
    modules.push(await verifyDrvoReadiness(pool, spec.module));
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
    } else if (mod.activationRequired) {
      const missingDeclared = (getDrvoModuleRolloutSpec(mod.module).readinessCheckIds || []).filter(
        (id) => !mod.checks.some((c) => c.id === id && c.ok),
      );
      if (missingDeclared.length) {
        failures.push(
          `REFUSING extracted activation for ${mod.module}: missing readiness (${missingDeclared.join(', ')})`,
        );
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
