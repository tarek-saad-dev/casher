import { describe, expect, it } from 'vitest';
import {
  runDrvoMigrationsCore,
  type DrvoRegistryPort,
} from '../runner';
import type {
  AppliedDrvoMigrationRow,
  DrvoMigrationContext,
  DrvoMigrationDefinition,
} from '../types';
import { PRODUCTION_DB } from '../types';

function memoryRegistry(): DrvoRegistryPort & { rows: AppliedDrvoMigrationRow[] } {
  const rows: AppliedDrvoMigrationRow[] = [];
  return {
    rows,
    async ensure() {},
    async list() {
      return [...rows];
    },
    async record(input) {
      rows.push({
        MigrationId: input.migrationId,
        MigrationKey: input.migrationKey,
        Name: input.name,
        Checksum: input.checksum,
        AppliedAtUtc: new Date(),
        AppCommitSha: input.appCommitSha,
        ExecutionMs: input.executionMs,
      });
    },
  };
}

function fakePool(dbName = 'last132_agent') {
  return {
    request() {
      return {
        query: async () => ({ recordset: [{ db: dbName }] }),
      };
    },
  } as never;
}

function def(partial: Partial<DrvoMigrationDefinition> & Pick<DrvoMigrationDefinition, 'migrationId' | 'migrationKey'>): DrvoMigrationDefinition {
  return {
    name: partial.name ?? partial.migrationKey,
    dependencies: partial.dependencies ?? [],
    checksum: partial.checksum ?? `sum-${partial.migrationKey}`,
    apply: partial.apply ?? (async () => {}),
    verify: partial.verify ?? (async () => ({ ok: true, failures: [] })),
    reconcileBaseline: partial.reconcileBaseline,
    ...partial,
  };
}

describe('runDrvoMigrationsCore', () => {
  it('1. clean state applies and records', async () => {
    const registry = memoryRegistry();
    let applied = false;
    const report = await runDrvoMigrationsCore({
      pool: fakePool(),
      databaseName: 'last132_agent',
      registry,
      opts: { allowProduction: false },
      migrations: [
        def({
          migrationId: 1,
          migrationKey: 'a',
          apply: async () => {
            applied = true;
          },
        }),
      ],
    });
    expect(applied).toBe(true);
    expect(report.applied).toEqual(['a']);
    expect(registry.rows).toHaveLength(1);
  });

  it('2. already applied migration is skipped', async () => {
    const registry = memoryRegistry();
    await registry.record({
      migrationId: 1,
      migrationKey: 'a',
      name: 'a',
      checksum: 'sum-a',
      appCommitSha: null,
      executionMs: 1,
    });
    let applyCount = 0;
    const report = await runDrvoMigrationsCore({
      pool: fakePool(),
      databaseName: 'last132_agent',
      registry,
      opts: { allowProduction: false },
      migrations: [
        def({
          migrationId: 1,
          migrationKey: 'a',
          apply: async () => {
            applyCount += 1;
          },
        }),
      ],
    });
    expect(applyCount).toBe(0);
    expect(report.skipped).toEqual(['a']);
    expect(registry.rows).toHaveLength(1);
  });

  it('3+4. baseline reconcile skips apply; idempotent rerun skips', async () => {
    const registry = memoryRegistry();
    let applyCount = 0;
    let baselineCalls = 0;
    const migrations = [
      def({
        migrationId: 1,
        migrationKey: 'a',
        reconcileBaseline: async () => {
          baselineCalls += 1;
          return true;
        },
        apply: async () => {
          applyCount += 1;
        },
      }),
    ];
    const first = await runDrvoMigrationsCore({
      pool: fakePool(),
      databaseName: 'last132_agent',
      registry,
      opts: { allowProduction: false },
      migrations,
    });
    expect(first.baselined).toEqual(['a']);
    expect(applyCount).toBe(0);
    expect(baselineCalls).toBe(1);

    const second = await runDrvoMigrationsCore({
      pool: fakePool(),
      databaseName: 'last132_agent',
      registry,
      opts: { allowProduction: false },
      migrations,
    });
    expect(second.skipped).toEqual(['a']);
    expect(applyCount).toBe(0);
  });

  it('5. checksum mismatch refuses', async () => {
    const registry = memoryRegistry();
    await registry.record({
      migrationId: 1,
      migrationKey: 'a',
      name: 'a',
      checksum: 'old',
      appCommitSha: null,
      executionMs: 1,
    });
    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(),
        databaseName: 'last132_agent',
        registry,
        opts: { allowProduction: false },
        migrations: [def({ migrationId: 1, migrationKey: 'a', checksum: 'new' })],
      }),
    ).rejects.toThrow(/checksum mismatch/);
  });

  it('6. ambiguous bootstrap tenant refuses via verify failure', async () => {
    const registry = memoryRegistry();
    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(),
        databaseName: 'last132_agent',
        registry,
        opts: { allowProduction: false },
        migrations: [
          def({
            migrationId: 1,
            migrationKey: 'boot',
            apply: async () => {},
            verify: async () => ({
              ok: false,
              failures: ['Expected one Tenant row, found 2'],
            }),
          }),
        ],
      }),
    ).rejects.toThrow(/verify failed/);
    expect(registry.rows).toHaveLength(0);
  });

  it('7+8. missing branch map repaired in apply; conflicting map aborts without registry row', async () => {
    const registry = memoryRegistry();
    const state = { map: null as string | null, locationId: 'loc-1' };

    await runDrvoMigrationsCore({
      pool: fakePool(),
      databaseName: 'last132_agent',
      registry,
      opts: { allowProduction: false },
      migrations: [
        def({
          migrationId: 1,
          migrationKey: 'map-repair',
          apply: async () => {
            if (state.map == null) state.map = state.locationId;
          },
          verify: async () =>
            state.map === state.locationId
              ? { ok: true, failures: [] }
              : { ok: false, failures: ['map missing'] },
        }),
      ],
    });
    expect(state.map).toBe('loc-1');
    expect(registry.rows).toHaveLength(1);

    const registry2 = memoryRegistry();
    const conflict = { map: 'other-id', locationId: 'loc-1' };
    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(),
        databaseName: 'last132_agent',
        registry: registry2,
        opts: { allowProduction: false },
        migrations: [
          def({
            migrationId: 1,
            migrationKey: 'map-conflict',
            apply: async () => {
              if (conflict.map !== conflict.locationId) {
                throw new Error('Abort: conflicting branch mapping');
              }
            },
          }),
        ],
      }),
    ).rejects.toThrow(/conflicting branch mapping/);
    expect(registry2.rows).toHaveLength(0);
  });

  it('9. existing IDs preserved (baseline records without recreate)', async () => {
    const registry = memoryRegistry();
    const ids = { tenantId: 'tenant-preserved' };
    await runDrvoMigrationsCore({
      pool: fakePool(),
      databaseName: 'last132_agent',
      registry,
      opts: { allowProduction: false },
      migrations: [
        def({
          migrationId: 1,
          migrationKey: 'preserve',
          reconcileBaseline: async () => true,
          apply: async () => {
            ids.tenantId = 'SHOULD_NOT_RUN';
          },
          verify: async () =>
            ids.tenantId === 'tenant-preserved'
              ? { ok: true, failures: [] }
              : { ok: false, failures: ['id replaced'] },
        }),
      ],
    });
    expect(ids.tenantId).toBe('tenant-preserved');
    expect(registry.rows[0]?.MigrationKey).toBe('preserve');
  });

  it('10. apply/verify failure does NOT write registry row', async () => {
    const registry = memoryRegistry();
    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(),
        databaseName: 'last132_agent',
        registry,
        opts: { allowProduction: false },
        migrations: [
          def({
            migrationId: 1,
            migrationKey: 'fail-apply',
            apply: async () => {
              throw new Error('apply boom');
            },
          }),
        ],
      }),
    ).rejects.toThrow(/apply boom/);
    expect(registry.rows).toHaveLength(0);

    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(),
        databaseName: 'last132_agent',
        registry,
        opts: { allowProduction: false },
        migrations: [
          def({
            migrationId: 1,
            migrationKey: 'fail-verify',
            verify: async () => ({ ok: false, failures: ['bad'] }),
          }),
        ],
      }),
    ).rejects.toThrow(/verify failed/);
    expect(registry.rows).toHaveLength(0);
  });

  it('11. dependency ordering enforced', async () => {
    const registry = memoryRegistry();
    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(),
        databaseName: 'last132_agent',
        registry,
        opts: { allowProduction: false },
        migrations: [
          def({
            migrationId: 2,
            migrationKey: 'child',
            dependencies: ['parent'],
          }),
        ],
      }),
    ).rejects.toThrow(/requires parent/);
  });

  it('12. baseline only records after full verification', async () => {
    const registry = memoryRegistry();
    let verified = false;
    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(),
        databaseName: 'last132_agent',
        registry,
        opts: { allowProduction: false },
        migrations: [
          def({
            migrationId: 1,
            migrationKey: 'baseline-verify',
            reconcileBaseline: async () => true,
            verify: async (_ctx: DrvoMigrationContext) => {
              verified = true;
              return { ok: false, failures: ['incomplete baseline'] };
            },
          }),
        ],
      }),
    ).rejects.toThrow(/incomplete baseline/);
    expect(verified).toBe(true);
    expect(registry.rows).toHaveLength(0);
  });

  it('refuses production without allowProduction', async () => {
    await expect(
      runDrvoMigrationsCore({
        pool: fakePool(PRODUCTION_DB),
        registry: memoryRegistry(),
        opts: { allowProduction: false },
        migrations: [],
      }),
    ).rejects.toThrow(/Refusing production/);
  });
});
