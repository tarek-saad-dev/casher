import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { invalidateTenantAccessGate } from '@/platform/commercial/accessGateMemo';
import { assertNotBootstrapTenant } from '@/platform/commercial/bootstrapGuard';
import type { SqlExecutor } from '@/platform/commercial/planRepository';
import { publishPlatformOutboxEvent } from '@/platform/outbox/publisher';
import type { AppCustomizations, IndustryPackDefinition } from '@/platform/packs/types';
import { ensureAppRegistryRows } from '@/platform/registry/seedTenantRegistry';
import {
  acquireTenantApplock,
  TENANT_COMMERCIAL_LOCK_PARTS,
} from '@/platform/tenant/tenantApplock';
import { getInstallableAppCatalog, isInstallableAppCode } from './appCatalog';
import {
  assertCanInstall,
  assertCanUninstall,
  resolveTenantComposition,
  type ResolvedComposition,
} from './compositionResolver';
import { TenantAppError } from './errors';

export type TenantAppSource = 'bootstrap' | 'pack' | 'customer' | 'platform_admin';
export type TenantAppStatus = 'installed' | 'disabled';

export interface TenantAppState {
  appCode: string;
  status: TenantAppStatus;
  source: TenantAppSource;
  installedAt: string | null;
  disabledAt: string | null;
}

export interface TenantPackState {
  packCode: string;
  packVersion: number;
  config: Record<string, unknown> | null;
}

export type PackResolver = (packCode: string) => IndustryPackDefinition | null;
export type TenantAppActor = { actorUserId: number };

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Installed-app state for one tenant. Only installable catalog codes are returned;
 * legacy `operations` surface rows are ignored (operations is not an app).
 */
export async function listTenantApps(
  tenantId: string,
  opts: { executor?: SqlExecutor; forUpdate?: boolean } = {},
): Promise<TenantAppState[]> {
  const ex = opts.executor ?? (await getPool());
  const hint = opts.forUpdate ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT AppCode, Status, Source, InstalledAt, DisabledAt
      FROM dbo.TenantAppEntitlement ${hint}
      WHERE TenantId = @tenantId
      ORDER BY AppCode;
    `);
  return (result.recordset as Array<Record<string, unknown>>)
    .filter((r) => isInstallableAppCode(String(r.AppCode)))
    .map((r) => ({
      appCode: String(r.AppCode),
      status: String(r.Status) as TenantAppStatus,
      source: String(r.Source) as TenantAppSource,
      installedAt: isoOrNull(r.InstalledAt),
      disabledAt: isoOrNull(r.DisabledAt),
    }));
}

export function installedAppCodes(apps: readonly TenantAppState[]): string[] {
  return apps.filter((a) => a.status === 'installed').map((a) => a.appCode).sort();
}

export async function getTenantPackState(
  ex: SqlExecutor,
  tenantId: string,
): Promise<TenantPackState | null> {
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT PackCode, PackVersion, ConfigJson
      FROM dbo.TenantIndustryPack
      WHERE TenantId = @tenantId;
    `);
  const row = result.recordset[0] as
    | { PackCode: string; PackVersion: number; ConfigJson: string }
    | undefined;
  if (!row) return null;
  let config: Record<string, unknown> | null = null;
  try {
    config = JSON.parse(String(row.ConfigJson)) as Record<string, unknown>;
  } catch {
    config = null;
  }
  return { packCode: String(row.PackCode), packVersion: Number(row.PackVersion), config };
}

export function listAvailableApps() {
  return getInstallableAppCatalog();
}

/** Set one app row to installed (insert or re-enable). Never deletes data. */
async function setAppInstalled(
  tx: Transaction,
  tenantId: string,
  appCode: string,
  source: TenantAppSource,
  now: Date,
): Promise<'inserted' | 'reinstalled' | 'unchanged'> {
  const result = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('code', sql.NVarChar(64), appCode)
    .input('source', sql.NVarChar(20), source)
    .input('now', sql.DateTime2, now)
    .query(`
      DECLARE @outcome NVARCHAR(16) = N'unchanged';
      IF NOT EXISTS (
        SELECT 1 FROM dbo.TenantAppEntitlement WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND AppCode = @code
      )
      BEGIN
        INSERT INTO dbo.TenantAppEntitlement (
          TenantId, AppCode, Enabled, Status, Source, InstalledAt, DisabledAt, UpdatedAt
        )
        VALUES (@tenantId, @code, 1, N'installed', @source, @now, NULL, @now);
        SET @outcome = N'inserted';
      END
      ELSE IF EXISTS (
        SELECT 1 FROM dbo.TenantAppEntitlement
        WHERE TenantId = @tenantId AND AppCode = @code AND Status = N'disabled'
      )
      BEGIN
        UPDATE dbo.TenantAppEntitlement
        SET Enabled = 1, Status = N'installed', Source = @source,
            InstalledAt = ISNULL(InstalledAt, @now), UpdatedAt = @now
        WHERE TenantId = @tenantId AND AppCode = @code;
        SET @outcome = N'reinstalled';
      END
      SELECT @outcome AS outcome;
    `);
  return String(result.recordset[0]?.outcome) as 'inserted' | 'reinstalled' | 'unchanged';
}

/** Disable tenant access to one app. Historical, financial and audit data is untouched. */
async function setAppDisabled(
  tx: Transaction,
  tenantId: string,
  appCode: string,
  now: Date,
): Promise<boolean> {
  const result = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('code', sql.NVarChar(64), appCode)
    .input('now', sql.DateTime2, now)
    .query(`
      UPDATE dbo.TenantAppEntitlement
      SET Enabled = 0, Status = N'disabled', DisabledAt = @now, UpdatedAt = @now
      WHERE TenantId = @tenantId AND AppCode = @code AND Status = N'installed';
      SELECT @@ROWCOUNT AS changed;
    `);
  return Number(result.recordset[0]?.changed) > 0;
}

async function upsertTenantIndustryPack(
  tx: Transaction,
  tenantId: string,
  pack: IndustryPackDefinition,
  composition: ResolvedComposition,
  now: Date,
): Promise<void> {
  const configJson = JSON.stringify({
    configDefaults: pack.configDefaults,
    customizations: { added: composition.added, removed: composition.removed },
  });
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('packCode', sql.NVarChar(64), pack.packCode)
    .input('packVersion', sql.Int, pack.version)
    .input('config', sql.NVarChar(sql.MAX), configJson)
    .input('now', sql.DateTime2, now)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.TenantIndustryPack WITH (UPDLOCK, HOLDLOCK) WHERE TenantId = @tenantId)
        UPDATE dbo.TenantIndustryPack
        SET PackCode = @packCode, PackVersion = @packVersion, ConfigJson = @config,
            AppliedAt = @now, UpdatedAt = @now
        WHERE TenantId = @tenantId;
      ELSE
        INSERT INTO dbo.TenantIndustryPack (TenantId, PackCode, PackVersion, ConfigJson, AppliedAt, UpdatedAt)
        VALUES (@tenantId, @packCode, @packVersion, @config, @now, @now);
    `);
}

/** SalonPackConfig compatibility seam: insert-only, never overwritten. */
async function ensureSalonPackConfigCompat(
  tx: Transaction,
  tenantId: string,
  pack: IndustryPackDefinition,
  composition: ResolvedComposition,
): Promise<void> {
  const manifestJson = JSON.stringify({
    packCode: pack.packCode,
    enabledApps: composition.apps,
    compositionSurfaces: pack.configDefaults.compositionSurfaces ?? [],
    extensions: [],
  });
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('packCode', sql.NVarChar(64), pack.packCode)
    .input('manifest', sql.NVarChar(sql.MAX), manifestJson)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.SalonPackConfig WHERE TenantId = @tenantId)
        INSERT INTO dbo.SalonPackConfig (TenantId, PackCode, ManifestJson)
        VALUES (@tenantId, @packCode, @manifest);
    `);
}

/**
 * Make the tenant's installed set exactly `composition.apps` and record pack state.
 * Apps leaving the set are disabled (data preserved); apps entering are installed
 * or re-enabled. Caller owns the transaction and the tenant commercial applock.
 */
export async function applyCompositionInTransaction(
  tx: Transaction,
  args: {
    tenantId: string;
    pack: IndustryPackDefinition;
    composition: ResolvedComposition;
    now: Date;
    actor: TenantAppActor;
    reason: 'onboarding' | 'apply_pack';
  },
): Promise<{ installed: string[]; disabled: string[] }> {
  const { tenantId, pack, composition, now } = args;
  await ensureAppRegistryRows(tx);

  const current = installedAppCodes(await listTenantApps(tenantId, { executor: tx, forUpdate: true }));
  const target = new Set<string>(composition.apps);
  const added = new Set<string>(composition.added);

  const installed: string[] = [];
  for (const code of composition.apps) {
    const source: TenantAppSource = added.has(code) ? 'customer' : 'pack';
    const outcome = await setAppInstalled(tx, tenantId, code, source, now);
    if (outcome !== 'unchanged') installed.push(code);
  }
  const disabled: string[] = [];
  for (const code of current) {
    if (!target.has(code) && (await setAppDisabled(tx, tenantId, code, now))) {
      disabled.push(code);
    }
  }

  await upsertTenantIndustryPack(tx, tenantId, pack, composition, now);
  await ensureSalonPackConfigCompat(tx, tenantId, pack, composition);

  const mutationId = randomUUID();
  await publishPlatformOutboxEvent(tx, {
    tenantId,
    aggregateType: 'tenant_apps',
    aggregateId: tenantId,
    eventType: 'tenant.pack.applied',
    payload: JSON.stringify({
      reason: args.reason,
      packCode: pack.packCode,
      packVersion: pack.version,
      apps: composition.apps,
      added: composition.added,
      removed: composition.removed,
      installed,
      disabled,
      actorUserId: args.actor.actorUserId,
    }),
    idempotencyKey: `tenant-apps:pack:${mutationId}`,
    correlationId: `tenant-apps:${tenantId}`,
    occurredAt: now,
  });

  return { installed, disabled };
}

async function withTenantAppsTx<T>(
  tenantId: string,
  operation: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const exists = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`SELECT 1 AS ok FROM dbo.Tenant WHERE TenantId = @tenantId;`);
    if (!exists.recordset.length) {
      throw new TenantAppError('TENANT_NOT_FOUND', 'Tenant not found', 404);
    }
    await assertNotBootstrapTenant(tx, tenantId, operation);
    await acquireTenantApplock(tx, tenantId, TENANT_COMMERCIAL_LOCK_PARTS);
    const out = await fn(tx);
    await tx.commit();
    invalidateTenantAccessGate(tenantId);
    return out;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Re-apply an Industry Pack with customizations to an existing tenant. */
export async function applyIndustryPack(
  tenantId: string,
  pack: IndustryPackDefinition,
  customizations: AppCustomizations,
  opts: { actor: TenantAppActor; now?: Date },
): Promise<{ composition: ResolvedComposition; installed: string[]; disabled: string[] }> {
  const composition = resolveTenantComposition(pack, customizations);
  const now = opts.now ?? new Date();
  return withTenantAppsTx(tenantId, 'applyIndustryPack', async (tx) => {
    const result = await applyCompositionInTransaction(tx, {
      tenantId,
      pack,
      composition,
      now,
      actor: opts.actor,
      reason: 'apply_pack',
    });
    return { composition, ...result };
  });
}

export async function installTenantApp(
  tenantId: string,
  appCode: string,
  opts: { actor: TenantAppActor; now?: Date },
): Promise<{ appCode: string; outcome: 'inserted' | 'reinstalled' }> {
  const now = opts.now ?? new Date();
  return withTenantAppsTx(tenantId, 'installTenantApp', async (tx) => {
    await ensureAppRegistryRows(tx);
    const installed = installedAppCodes(
      await listTenantApps(tenantId, { executor: tx, forUpdate: true }),
    );
    const code = assertCanInstall(installed, appCode);
    const outcome = await setAppInstalled(tx, tenantId, code, 'platform_admin', now);
    if (outcome === 'unchanged') {
      throw new TenantAppError('APP_ALREADY_INSTALLED', `App already installed: ${code}`, 409);
    }
    await publishPlatformOutboxEvent(tx, {
      tenantId,
      aggregateType: 'tenant_apps',
      aggregateId: tenantId,
      eventType: 'tenant.app.installed',
      payload: JSON.stringify({ appCode: code, outcome, actorUserId: opts.actor.actorUserId }),
      idempotencyKey: `tenant-apps:install:${code}:${randomUUID()}`,
      correlationId: `tenant-apps:${tenantId}`,
      occurredAt: now,
    });
    return { appCode: code, outcome };
  });
}

/** Disable an app for a tenant. Preserves all historical data; reinstall restores access. */
export async function uninstallTenantApp(
  tenantId: string,
  appCode: string,
  opts: { actor: TenantAppActor; resolvePack: PackResolver; now?: Date },
): Promise<{ appCode: string }> {
  const now = opts.now ?? new Date();
  return withTenantAppsTx(tenantId, 'uninstallTenantApp', async (tx) => {
    const installed = installedAppCodes(
      await listTenantApps(tenantId, { executor: tx, forUpdate: true }),
    );
    const packState = await getTenantPackState(tx, tenantId);
    const pack = packState ? opts.resolvePack(packState.packCode) : null;
    const code = assertCanUninstall(installed, appCode, pack);
    await setAppDisabled(tx, tenantId, code, now);
    await publishPlatformOutboxEvent(tx, {
      tenantId,
      aggregateType: 'tenant_apps',
      aggregateId: tenantId,
      eventType: 'tenant.app.disabled',
      payload: JSON.stringify({
        appCode: code,
        dataPreserved: true,
        actorUserId: opts.actor.actorUserId,
      }),
      idempotencyKey: `tenant-apps:disable:${code}:${randomUUID()}`,
      correlationId: `tenant-apps:${tenantId}`,
      occurredAt: now,
    });
    return { appCode: code };
  });
}
