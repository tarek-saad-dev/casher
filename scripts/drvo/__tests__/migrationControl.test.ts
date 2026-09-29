import { describe, expect, it } from 'vitest';
import {
  assertApprovedDrvoProductionPlan,
  buildDrvoProductionMigrationPlan,
  computeDrvoMigrationManifestDigest,
} from '../migration-control';
import type { AppliedDrvoMigrationRow, DrvoMigrationDefinition } from '../types';

function migration(
  migrationId: number,
  migrationKey: string,
  checksum: string,
  overrides: Partial<DrvoMigrationDefinition['control']> = {},
): DrvoMigrationDefinition {
  return {
    migrationId,
    migrationKey,
    name: migrationKey,
    dependencies: migrationId === 1 ? [] : ['one'],
    checksum,
    control: {
      kind: 'schema',
      risk: 'LOW',
      requiresBackup: false,
      lockProfile: 'short',
      rollbackStrategy: 'test rollback',
      ...overrides,
    },
    async apply() {},
    async verify() {
      return { ok: true, failures: [] };
    },
  };
}

function applied(
  migrationId: number,
  migrationKey: string,
  checksum: string,
): AppliedDrvoMigrationRow {
  return {
    MigrationId: migrationId,
    MigrationKey: migrationKey,
    Name: migrationKey,
    Checksum: checksum,
    AppliedAtUtc: new Date('2026-01-01T00:00:00Z'),
    AppCommitSha: null,
    ExecutionMs: 1,
  };
}

describe('production migration control', () => {
  it('binds migration control metadata into the manifest digest', () => {
    const a = [migration(1, 'one', 'a'.repeat(64))];
    const b = [
      migration(1, 'one', 'a'.repeat(64), {
        risk: 'HIGH',
        requiresBackup: true,
      }),
    ];

    expect(computeDrvoMigrationManifestDigest(a)).not.toBe(
      computeDrvoMigrationManifestDigest(b),
    );
  });

  it('plans only unapplied migrations and reports highest risk / backup requirement', () => {
    const migrations = [
      migration(1, 'one', 'a'.repeat(64)),
      migration(2, 'two', 'b'.repeat(64), {
        risk: 'HIGH',
        requiresBackup: true,
      }),
    ];

    const plan = buildDrvoProductionMigrationPlan({
      migrations,
      appliedRows: [applied(1, 'one', 'a'.repeat(64))],
    });

    expect(plan.ok).toBe(true);
    expect(plan.pending.map((m) => m.migrationKey)).toEqual(['two']);
    expect(plan.highestRisk).toBe('HIGH');
    expect(plan.requiresBackup).toBe(true);
  });

  it('fails closed on checksum drift', () => {
    const migrations = [migration(1, 'one', 'a'.repeat(64))];
    const plan = buildDrvoProductionMigrationPlan({
      migrations,
      appliedRows: [applied(1, 'one', 'b'.repeat(64))],
    });

    expect(plan.ok).toBe(false);
    expect(plan.checksumMismatches).toEqual(['one']);
  });

  it('refuses a changed approved migration set or manifest digest', () => {
    const migrations = [migration(1, 'one', 'a'.repeat(64))];
    const plan = buildDrvoProductionMigrationPlan({ migrations, appliedRows: [] });

    expect(() =>
      assertApprovedDrvoProductionPlan({
        plan,
        approvedManifestDigest: 'f'.repeat(64),
        approvedMigrationKeys: ['one'],
      }),
    ).toThrow(/manifest digest changed/i);

    expect(() =>
      assertApprovedDrvoProductionPlan({
        plan,
        approvedManifestDigest: plan.manifestDigest,
        approvedMigrationKeys: [],
      }),
    ).toThrow(/pending migration set changed/i);
  });

  it('requires a backup reference when any approved migration requires backup', () => {
    const migrations = [
      migration(1, 'one', 'a'.repeat(64), {
        risk: 'HIGH',
        requiresBackup: true,
      }),
    ];
    const plan = buildDrvoProductionMigrationPlan({ migrations, appliedRows: [] });

    expect(() =>
      assertApprovedDrvoProductionPlan({
        plan,
        approvedManifestDigest: plan.manifestDigest,
        approvedMigrationKeys: ['one'],
      }),
    ).toThrow(/backup reference/i);

    expect(() =>
      assertApprovedDrvoProductionPlan({
        plan,
        approvedManifestDigest: plan.manifestDigest,
        approvedMigrationKeys: ['one'],
        backupReference: 'hostinger-snapshot-2026-09-30T0053',
      }),
    ).not.toThrow();
  });
});
