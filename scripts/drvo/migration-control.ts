import type {
  AppliedDrvoMigrationRow,
  DrvoMigrationControlMetadata,
  DrvoMigrationDefinition,
  DrvoMigrationRisk,
} from './types';
import { sha256Hex } from './checksum';

export type DrvoProductionMigrationPlanItem = {
  migrationId: number;
  migrationKey: string;
  name: string;
  checksum: string;
  dependencies: string[];
  control: DrvoMigrationControlMetadata;
};

export type DrvoProductionMigrationPlan = {
  manifestDigest: string;
  pending: DrvoProductionMigrationPlanItem[];
  checksumMismatches: string[];
  unknownApplied: string[];
  highestRisk: DrvoMigrationRisk | null;
  requiresBackup: boolean;
  ok: boolean;
};

const RISK_ORDER: Record<DrvoMigrationRisk, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function normalizeMigration(m: DrvoMigrationDefinition) {
  return {
    migrationId: m.migrationId,
    migrationKey: m.migrationKey,
    name: m.name,
    dependencies: [...m.dependencies],
    checksum: m.checksum,
    control: {
      kind: m.control.kind,
      risk: m.control.risk,
      requiresBackup: m.control.requiresBackup,
      lockProfile: m.control.lockProfile,
      rollbackStrategy: m.control.rollbackStrategy,
    },
  };
}

export function computeDrvoMigrationManifestDigest(
  migrations: DrvoMigrationDefinition[],
): string {
  const normalized = [...migrations]
    .sort((a, b) => a.migrationId - b.migrationId)
    .map(normalizeMigration);
  return sha256Hex(JSON.stringify(normalized));
}

export function buildDrvoProductionMigrationPlan(args: {
  migrations: DrvoMigrationDefinition[];
  appliedRows: AppliedDrvoMigrationRow[];
}): DrvoProductionMigrationPlan {
  const { migrations, appliedRows } = args;
  const appliedByKey = new Map(appliedRows.map((row) => [row.MigrationKey, row]));
  const definitionByKey = new Map(migrations.map((migration) => [migration.migrationKey, migration]));

  const checksumMismatches: string[] = [];
  for (const migration of migrations) {
    const row = appliedByKey.get(migration.migrationKey);
    if (row && row.Checksum !== migration.checksum) {
      checksumMismatches.push(migration.migrationKey);
    }
  }

  const unknownApplied = appliedRows
    .map((row) => row.MigrationKey)
    .filter((key) => !definitionByKey.has(key))
    .sort();

  const pending = migrations
    .filter((migration) => !appliedByKey.has(migration.migrationKey))
    .sort((a, b) => a.migrationId - b.migrationId)
    .map(normalizeMigration);

  let highestRisk: DrvoMigrationRisk | null = null;
  for (const item of pending) {
    if (highestRisk == null || RISK_ORDER[item.control.risk] > RISK_ORDER[highestRisk]) {
      highestRisk = item.control.risk;
    }
  }

  return {
    manifestDigest: computeDrvoMigrationManifestDigest(migrations),
    pending,
    checksumMismatches,
    unknownApplied,
    highestRisk,
    requiresBackup: pending.some((item) => item.control.requiresBackup),
    ok: checksumMismatches.length === 0 && unknownApplied.length === 0,
  };
}

export function assertApprovedDrvoProductionPlan(args: {
  plan: DrvoProductionMigrationPlan;
  approvedManifestDigest: string;
  approvedMigrationKeys: string[];
  backupReference?: string | null;
}): void {
  const { plan, approvedManifestDigest, approvedMigrationKeys } = args;

  if (!plan.ok) {
    const details = [
      plan.checksumMismatches.length
        ? `checksum mismatches: ${plan.checksumMismatches.join(', ')}`
        : null,
      plan.unknownApplied.length
        ? `unknown applied migrations: ${plan.unknownApplied.join(', ')}`
        : null,
    ].filter(Boolean);
    throw new Error(`Production migration plan is not safe: ${details.join('; ')}`);
  }

  if (plan.manifestDigest !== approvedManifestDigest) {
    throw new Error(
      `Migration manifest digest changed after approval: approved=${approvedManifestDigest} current=${plan.manifestDigest}`,
    );
  }

  const pendingKeys = plan.pending.map((item) => item.migrationKey);
  if (
    pendingKeys.length !== approvedMigrationKeys.length ||
    pendingKeys.some((key, index) => key !== approvedMigrationKeys[index])
  ) {
    throw new Error(
      `Pending migration set changed after approval: approved=[${approvedMigrationKeys.join(', ')}] current=[${pendingKeys.join(', ')}]`,
    );
  }

  if (plan.requiresBackup && !String(args.backupReference ?? '').trim()) {
    throw new Error(
      'At least one approved migration requires a backup reference before production apply.',
    );
  }
}
