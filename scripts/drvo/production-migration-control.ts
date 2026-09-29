#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const moduleWithLoad = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return originalModuleLoad.call(moduleWithLoad, request, ...rest);
};

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function requireSha(value: string | undefined, label: string): string {
  if (!value || !/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error(`${label} must be a full 40-character git SHA.`);
  }
  return value.toLowerCase();
}

function parseMigrationKeys(value: string | undefined): string[] {
  if (!value) return [];
  const keys = value.split(',').map((v) => v.trim()).filter(Boolean);
  if (keys.some((key) => !/^[a-z0-9-]+$/.test(key))) {
    throw new Error('approved-migrations contains an invalid migration key.');
  }
  return keys;
}

async function main() {
  const mode = argValue('mode');
  if (mode !== 'plan' && mode !== 'apply') {
    throw new Error('--mode must be plan or apply.');
  }

  const approvedSha = requireSha(argValue('approved-sha'), 'approved-sha');
  const sourceSha = requireSha(process.env.SOURCE_COMMIT_SHA, 'SOURCE_COMMIT_SHA');
  if (sourceSha !== approvedSha) {
    throw new Error(`Approved SHA mismatch: approved=${approvedSha} source=${sourceSha}`);
  }

  const { getPool, closePool } = await import('../../src/lib/db');
  const { DRVO_MIGRATIONS, assertDrvoMigrationManifestValid } = await import('./migrations/index');
  const { listAppliedDrvoMigrations } = await import('./registry');
  const { buildDrvoProductionMigrationPlan, assertApprovedDrvoProductionPlan } =
    await import('./migration-control');
  const { runDrvoMigrations, PRODUCTION_DB } = await import('./runner');

  assertDrvoMigrationManifestValid();

  try {
    const pool = await getPool();
    const dbResult = await pool.request().query('SELECT DB_NAME() AS db;');
    const database = String(dbResult.recordset[0]?.db ?? '');
    if (database !== PRODUCTION_DB) {
      throw new Error(`Production migration control refuses DB_NAME()="${database}".`);
    }

    const appliedRows = await listAppliedDrvoMigrations(pool);
    const plan = buildDrvoProductionMigrationPlan({
      migrations: DRVO_MIGRATIONS,
      appliedRows,
    });

    if (mode === 'plan') {
      console.log(JSON.stringify({
        mode,
        approvedSha,
        database,
        plan,
      }, null, 2));
      return;
    }

    const approvedManifestDigest = argValue('approved-manifest-digest') ?? '';
    if (!/^[a-f0-9]{64}$/i.test(approvedManifestDigest)) {
      throw new Error('approved-manifest-digest must be a SHA-256 hex digest.');
    }

    const approvedMigrationKeys = parseMigrationKeys(argValue('approved-migrations'));
    const backupReference = argValue('backup-reference')?.trim() || null;
    const approvalRef = argValue('approval-ref')?.trim() || null;
    if (!approvalRef) {
      throw new Error('approval-ref is required for production apply.');
    }

    assertApprovedDrvoProductionPlan({
      plan,
      approvedManifestDigest: approvedManifestDigest.toLowerCase(),
      approvedMigrationKeys,
      backupReference,
    });

    const runReport = await runDrvoMigrations(pool, {
      allowProduction: true,
      appCommitSha: approvedSha,
      approvalRef,
      backupRef: backupReference,
    });

    const afterRows = await listAppliedDrvoMigrations(pool);
    const afterPlan = buildDrvoProductionMigrationPlan({
      migrations: DRVO_MIGRATIONS,
      appliedRows: afterRows,
    });

    if (!runReport.ok || !afterPlan.ok || afterPlan.pending.length !== 0) {
      throw new Error('Post-migration verification did not reach a clean migration state.');
    }

    console.log(JSON.stringify({
      mode,
      approvedSha,
      database,
      approvalRef,
      backupReference,
      before: plan,
      runReport,
      after: afterPlan,
      ok: true,
    }, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
