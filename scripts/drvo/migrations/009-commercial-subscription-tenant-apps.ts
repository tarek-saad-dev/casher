import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';
import { APP_REGISTRY_CODES } from '../../../src/platform/registry/constants';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '009-commercial-subscription-tenant-apps',
  'schema.sql',
);

export const COMMERCIAL_MIGRATION_KEY = 'commercial-subscription-tenant-apps';

export const BASELINE_PLAN_CODES = ['starter', 'growth', 'pro', 'internal'] as const;

const REQUIRED_COLUMNS: Record<string, string[]> = {
  SaaSPlan: [
    'PlanCode',
    'DisplayName',
    'IsPublic',
    'IsActive',
    'SortOrder',
    'MaxBranches',
    'MaxUsers',
    'TrialDays',
    'PastDueGraceDays',
  ],
  TenantSubscription: [
    'TenantId',
    'PlanCode',
    'Status',
    'Origin',
    'TrialStartedAt',
    'TrialEndsAt',
    'CurrentPeriodEndsAt',
    'PastDueSince',
    'SuspendedAt',
    'CancelledAt',
    'Revision',
  ],
  TenantIndustryPack: ['TenantId', 'PackCode', 'PackVersion', 'ConfigJson', 'AppliedAt'],
  TenantAppEntitlement: ['Status', 'Source', 'InstalledAt', 'DisabledAt', 'UpdatedAt'],
};

const REQUIRED_CONSTRAINTS = [
  'PK_SaaSPlan',
  'PK_TenantSubscription',
  'FK_TenantSubscription_Tenant',
  'FK_TenantSubscription_Plan',
  'CK_TenantSubscription_Status',
  'CK_TenantSubscription_Origin',
  'PK_TenantIndustryPack',
  'FK_TenantIndustryPack_Tenant',
  'CK_TenantAppEntitlement_Status',
  'CK_TenantAppEntitlement_Source',
];

/**
 * Insert-only repair using the migration's grandfather rule: tenants created without a
 * subscription (e.g. by pre-DRVO-012 code during an app rollback) become internal/active
 * with no expiry clock. Existing subscriptions are never modified. Returns tenant codes.
 */
export async function reconcileGrandfatheredSubscriptions(pool: ConnectionPool): Promise<string[]> {
  const result = await pool.request().query(`
    SET XACT_ABORT ON;
    BEGIN TRAN;
    DECLARE @inserted TABLE (TenantId UNIQUEIDENTIFIER);
    INSERT INTO dbo.TenantSubscription (TenantId, PlanCode, Status, Origin)
    OUTPUT inserted.TenantId INTO @inserted
    SELECT t.TenantId, N'internal', N'active', N'migration_grandfathered'
    FROM dbo.Tenant t WITH (UPDLOCK, HOLDLOCK)
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.TenantSubscription s WITH (UPDLOCK, HOLDLOCK) WHERE s.TenantId = t.TenantId
    );
    COMMIT TRAN;
    SELECT t.Code FROM @inserted i JOIN dbo.Tenant t ON t.TenantId = i.TenantId ORDER BY t.Code;
  `);
  return (result.recordset as Array<{ Code: string }>).map((r) => r.Code);
}

/**
 * Read-only verification. Expected CASHER_BOOT apps derive from the registry
 * source of truth (APP_REGISTRY_CODES), never from a hardcoded count.
 */
export async function verifyCommercialSubscriptionSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const t = await pool
      .request()
      .input('name', `dbo.${table}`)
      .query(`SELECT CASE WHEN OBJECT_ID(@name, N'U') IS NULL THEN 0 ELSE 1 END AS ok;`);
    if (Number(t.recordset[0]?.ok) !== 1) {
      failures.push(`Missing table dbo.${table}`);
      continue;
    }
    for (const column of columns) {
      const c = await pool
        .request()
        .input('name', `dbo.${table}`)
        .input('column', column)
        .query(`SELECT CASE WHEN COL_LENGTH(@name, @column) IS NULL THEN 0 ELSE 1 END AS ok;`);
      if (Number(c.recordset[0]?.ok) !== 1) {
        failures.push(`Missing column dbo.${table}.${column}`);
      }
    }
  }
  if (failures.length) return { ok: false, failures };

  for (const name of REQUIRED_CONSTRAINTS) {
    const r = await pool
      .request()
      .input('name', name)
      .query(`
        SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.objects WHERE name = @name) THEN 1 ELSE 0 END AS ok;
      `);
    if (Number(r.recordset[0]?.ok) !== 1) failures.push(`Missing constraint ${name}`);
  }

  const plans = await pool.request().query(`
    SELECT PlanCode, IsPublic, MaxBranches, MaxUsers FROM dbo.SaaSPlan WITH (NOLOCK);
  `);
  const planRows = plans.recordset as Array<{
    PlanCode: string;
    IsPublic: boolean | number;
    MaxBranches: number | null;
    MaxUsers: number | null;
  }>;
  for (const code of BASELINE_PLAN_CODES) {
    if (!planRows.some((p) => p.PlanCode === code)) failures.push(`Missing SaaSPlan ${code}`);
  }
  const internal = planRows.find((p) => p.PlanCode === 'internal');
  if (internal) {
    if (Boolean(internal.IsPublic)) failures.push('SaaSPlan internal must not be public');
    if (internal.MaxBranches != null || internal.MaxUsers != null) {
      failures.push('SaaSPlan internal must be unlimited (NULL limits)');
    }
  }

  const missingSubs = await pool.request().query(`
    SELECT t.Code FROM dbo.Tenant t WITH (NOLOCK)
    WHERE NOT EXISTS (SELECT 1 FROM dbo.TenantSubscription s WITH (NOLOCK) WHERE s.TenantId = t.TenantId);
  `);
  for (const row of missingSubs.recordset as Array<{ Code: string }>) {
    failures.push(
      `Tenant ${row.Code} has no TenantSubscription (repair: npm run drvo-012:reconcile-subscriptions)`,
    );
  }

  const badGrandfathered = await pool.request().query(`
    SELECT t.Code FROM dbo.TenantSubscription s WITH (NOLOCK)
    JOIN dbo.Tenant t WITH (NOLOCK) ON t.TenantId = s.TenantId
    WHERE s.Origin = N'migration_grandfathered'
      AND (
        s.PlanCode <> N'internal' OR s.Status <> N'active'
        OR s.TrialStartedAt IS NOT NULL OR s.TrialEndsAt IS NOT NULL
        OR s.CurrentPeriodEndsAt IS NOT NULL OR s.PastDueSince IS NOT NULL
        OR s.SuspendedAt IS NOT NULL OR s.CancelledAt IS NOT NULL
      );
  `);
  for (const row of badGrandfathered.recordset as Array<{ Code: string }>) {
    failures.push(`Grandfathered tenant ${row.Code} must be internal/active with no expiry dates`);
  }

  const boot = await pool.request().query(`
    SELECT TOP 1 t.TenantId, s.PlanCode, s.Status, s.Origin
    FROM dbo.Tenant t WITH (NOLOCK)
    LEFT JOIN dbo.TenantSubscription s WITH (NOLOCK) ON s.TenantId = t.TenantId
    WHERE t.Code = N'CASHER_BOOT';
  `);
  const bootRow = boot.recordset[0] as
    | { TenantId: string; PlanCode: string | null; Status: string | null; Origin: string | null }
    | undefined;
  if (bootRow) {
    if (bootRow.PlanCode !== 'internal' || bootRow.Status !== 'active') {
      failures.push(
        `CASHER_BOOT subscription must be internal/active (got ${bootRow.PlanCode}/${bootRow.Status})`,
      );
    }
    const installed = await pool
      .request()
      .input('tenantId', bootRow.TenantId)
      .query(`
        SELECT AppCode FROM dbo.TenantAppEntitlement WITH (NOLOCK)
        WHERE TenantId = @tenantId AND Status = N'installed' AND Enabled = 1;
      `);
    const installedSet = new Set(
      (installed.recordset as Array<{ AppCode: string }>).map((r) => String(r.AppCode)),
    );
    for (const code of APP_REGISTRY_CODES) {
      if (!installedSet.has(code)) failures.push(`CASHER_BOOT lost installed app ${code}`);
    }
    const pack = await pool
      .request()
      .input('tenantId', bootRow.TenantId)
      .query(`SELECT PackCode FROM dbo.TenantIndustryPack WITH (NOLOCK) WHERE TenantId = @tenantId;`);
    if (!pack.recordset.length) failures.push('CASHER_BOOT has no TenantIndustryPack row');
  }

  return { ok: failures.length === 0, failures };
}

export const commercialSubscriptionTenantAppsMigration: DrvoMigrationDefinition = {
  migrationId: 9,
  migrationKey: COMMERCIAL_MIGRATION_KEY,
  name: 'DRVO-012 Commercial plans, subscriptions, industry pack and installed-app state',
  dependencies: ['platform-core', 'platform-bootstrap'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'mixed',
    risk: 'MEDIUM',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive schema: roll back by reverting the application commit (legacy code reads only TenantAppEntitlement.Enabled and ignores new tables/columns), then forward-fix. Restore the approved backup only when explicitly required. Dropping DRVO-012 tables/columns is not a normal rollback and needs explicit approval before any real use.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyCommercialSubscriptionSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    const report = await verifyCommercialSubscriptionSchema(ctx.pool);
    return report.ok;
  },
};
