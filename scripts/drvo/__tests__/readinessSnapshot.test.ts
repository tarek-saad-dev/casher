import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionPool } from 'mssql';

const spies = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  coreStructure: vi.fn(),
  treasury: vi.fn(),
  trigger: vi.fn(),
  appliedMigrations: vi.fn(),
}));

vi.mock('../platformBootstrap', () => ({
  verifyPlatformBootstrap: spies.bootstrap,
}));
vi.mock('../platformCoreSchema', () => ({
  verifyPlatformCoreStructure: spies.coreStructure,
}));
vi.mock('../migrations/006-treasury-movement-registry', () => ({
  verifyTreasuryMovementSchema: spies.treasury,
}));
vi.mock('../migrations/008-ins-cash-move-sales-guard', () => ({
  verifyInsCashMoveSalesGuard: spies.trigger,
}));
vi.mock('../migrations/009-commercial-subscription-tenant-apps', () => ({
  COMMERCIAL_MIGRATION_KEY: 'commercial-subscription-tenant-apps',
  verifyCommercialSubscriptionSchema: vi.fn(),
}));
vi.mock('../migrations/010-master-data-tenancy', () => ({
  MASTER_DATA_MIGRATION_KEY: 'master-data-tenancy',
  verifyMasterDataTenancySchema: vi.fn(),
}));
vi.mock('../migrations/index', () => ({
  DRVO_MIGRATIONS: [],
  assertDrvoMigrationManifestValid: () => undefined,
  getDrvoModuleRequiredMigrations: () => ({
    booking: [],
    'pos-sale-treasury': [],
    'pos-sale-treasury-mutation': [],
  }),
}));
vi.mock('../registry', () => ({
  listAppliedDrvoMigrations: spies.appliedMigrations,
}));
vi.mock('../../../src/platform/drvo/moduleManifest', () => {
  const specs = [
    {
      module: 'booking', rollout: 'extracted', dependencies: [],
      requiredMigrationKeys: [],
      readinessCheckIds: ['platform.core.structure', 'platform.bootstrap'],
    },
    {
      module: 'pos-sale-treasury', rollout: 'extracted', dependencies: [],
      requiredMigrationKeys: [],
      readinessCheckIds: [
        'platform.core.structure', 'platform.bootstrap',
        'treasury.schema', 'treasury.sale-trigger-guard',
      ],
    },
    {
      module: 'pos-sale-treasury-mutation', rollout: 'extracted', dependencies: [],
      requiredMigrationKeys: [],
      readinessCheckIds: [
        'platform.core.structure', 'platform.bootstrap',
        'treasury.schema', 'treasury.sale-trigger-guard',
      ],
    },
  ];
  return {
    DRVO_MODULE_ROLLOUT: specs,
    assertAllDrvoRolloutContracts: () => undefined,
    getDrvoModuleRolloutSpec: (name: string) =>
      specs.find(spec => spec.module === name),
  };
});

import { verifyDrvoReadiness, verifyDrvoSystem } from '../readiness';

const fakePool = {
  request: () => ({ query: async () => ({ recordset: [{ db: 'last132_agent' }] }) }),
} as unknown as ConnectionPool;

describe('DRVO release readiness snapshot — no repeated expensive bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spies.bootstrap.mockResolvedValue({ ok: true, failures: [] });
    spies.coreStructure.mockResolvedValue({ ok: true, failures: [] });
    spies.treasury.mockResolvedValue({ ok: true, failures: [] });
    spies.trigger.mockResolvedValue({ ok: true, failures: [] });
    spies.appliedMigrations.mockResolvedValue([]);
  });

  it('reads all shared SQL readiness checks once across every extracted module', async () => {
    const result = await verifyDrvoSystem(fakePool);
    expect(result.ok).toBe(true);
    expect(result.modules).toHaveLength(3);
    expect(spies.appliedMigrations).toHaveBeenCalledTimes(1);
    expect(spies.bootstrap).toHaveBeenCalledTimes(1);
    expect(spies.coreStructure).toHaveBeenCalledTimes(1);
    expect(spies.treasury).toHaveBeenCalledTimes(1);
    expect(spies.trigger).toHaveBeenCalledTimes(1);
    expect(result.modules.every(m => m.ok)).toBe(true);
    expect(result.modules.filter(m => m.module.startsWith('pos-sale-treasury')))
      .toHaveLength(2);
  });

  it('fails every extracted module when a committed tenant membership is missing', async () => {
    spies.bootstrap.mockResolvedValue({
      ok: false,
      failures: ['Missing TenantMembership for UserID 170'],
    });
    const result = await verifyDrvoSystem(fakePool);
    expect(result.ok).toBe(false);
    expect(result.platformCore.ok).toBe(false);
    expect(result.failures).toContain('Missing TenantMembership for UserID 170');
    expect(result.modules.every(m => m.ok === false)).toBe(true);
    expect(result.modules.every(m =>
      m.checks.some(c => c.id === 'platform.bootstrap' && !c.ok))).toBe(true);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('REFUSING extracted activation for pos-sale-treasury:'),
    ]));
    expect(spies.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('standalone per-module verification still performs its own fresh SQL checks', async () => {
    const result = await verifyDrvoReadiness(fakePool, 'booking');
    expect(result.ok).toBe(true);
    expect(spies.bootstrap).toHaveBeenCalledTimes(1);
    expect(spies.coreStructure).toHaveBeenCalledTimes(1);
    expect(spies.appliedMigrations).toHaveBeenCalledTimes(1);
  });
});
