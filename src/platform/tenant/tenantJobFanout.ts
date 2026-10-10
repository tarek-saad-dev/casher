import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  evaluateTenantSubscriptionGate,
  getTenantInstalledAppsForGate,
} from '@/platform/commercial/tenantAccessGate';
import type { AppRegistryCode } from '@/platform/registry/constants';

/** One tenant a system job may act on, with the legacy branch ids of its active Locations. */
export interface TenantJobTarget {
  tenantId: string;
  tenantCode: string;
  branchIds: number[];
}

export type TenantJobSkipReason = 'SUBSCRIPTION_INACTIVE' | 'APP_NOT_INSTALLED' | 'NO_ACTIVE_LOCATION';

export interface TenantJobSkip {
  tenantId: string;
  tenantCode: string;
  reason: TenantJobSkipReason;
}

/**
 * Who a system job runs for. A cron bearer fans out over every tenant; an admin session
 * triggering the same job is limited to that admin's authoritative tenant.
 */
export type TenantJobScope = { kind: 'all_tenants' } | { kind: 'single_tenant'; tenantId: string };

export function tenantJobScopeFor(jobAuth: {
  via: 'cron_bearer' | 'session';
  tenantId: string | null;
}): TenantJobScope {
  if (jobAuth.via === 'cron_bearer') return { kind: 'all_tenants' };
  if (!jobAuth.tenantId) {
    throw new Error('Session-triggered system job has no authoritative tenant');
  }
  return { kind: 'single_tenant', tenantId: jobAuth.tenantId.toLowerCase() };
}

/**
 * Active tenants (and their active Locations) eligible for a job: the DRVO-012 subscription
 * must allow access and, when `app` is given, that app must be installed for the tenant.
 * Ineligible tenants are reported, never processed.
 */
export async function listTenantJobTargets(opts: {
  scope: TenantJobScope;
  app?: AppRegistryCode;
}): Promise<{ targets: TenantJobTarget[]; skipped: TenantJobSkip[] }> {
  const pool = await getPool();
  const req = pool.request();
  let tenantFilter = '';
  if (opts.scope.kind === 'single_tenant') {
    req.input('tenantId', sql.UniqueIdentifier, opts.scope.tenantId);
    tenantFilter = 'AND t.TenantId = @tenantId';
  }
  const result = await req.query(`
    SELECT t.TenantId, t.Code, l.LegacyBranchId
    FROM dbo.Tenant t
    LEFT JOIN dbo.Location l ON l.TenantId = t.TenantId AND l.Status = N'active'
    WHERE t.Status = N'active' ${tenantFilter}
    ORDER BY t.Code, l.LegacyBranchId;
  `);

  const byTenant = new Map<string, TenantJobTarget>();
  for (const row of result.recordset as Array<{ TenantId: string; Code: string; LegacyBranchId: number | null }>) {
    const tenantId = String(row.TenantId).toLowerCase();
    let target = byTenant.get(tenantId);
    if (!target) {
      target = { tenantId, tenantCode: String(row.Code), branchIds: [] };
      byTenant.set(tenantId, target);
    }
    if (row.LegacyBranchId != null) target.branchIds.push(Number(row.LegacyBranchId));
  }

  const targets: TenantJobTarget[] = [];
  const skipped: TenantJobSkip[] = [];
  for (const target of byTenant.values()) {
    const skip = (reason: TenantJobSkipReason) =>
      skipped.push({ tenantId: target.tenantId, tenantCode: target.tenantCode, reason });
    if (target.branchIds.length === 0) {
      skip('NO_ACTIVE_LOCATION');
      continue;
    }
    const subscription = await evaluateTenantSubscriptionGate(target.tenantId);
    if (!subscription.allowed) {
      skip('SUBSCRIPTION_INACTIVE');
      continue;
    }
    if (opts.app && !(await getTenantInstalledAppsForGate(target.tenantId)).includes(opts.app)) {
      skip('APP_NOT_INSTALLED');
      continue;
    }
    targets.push(target);
  }
  return { targets, skipped };
}

export interface TenantJobOutcome<R> {
  tenantId: string;
  tenantCode: string;
  ok: boolean;
  result?: R;
  error?: string;
}

/**
 * Run a system job tenant-by-tenant. Each invocation only receives its own tenant's
 * branch ids; one tenant's failure never stops the others.
 */
export async function runTenantJobFanout<R>(
  opts: { scope: TenantJobScope; app?: AppRegistryCode; job: string },
  run: (target: TenantJobTarget) => Promise<R>,
): Promise<{ outcomes: TenantJobOutcome<R>[]; skipped: TenantJobSkip[] }> {
  const { targets, skipped } = await listTenantJobTargets(opts);
  const outcomes: TenantJobOutcome<R>[] = [];
  for (const target of targets) {
    try {
      outcomes.push({ tenantId: target.tenantId, tenantCode: target.tenantCode, ok: true, result: await run(target) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[tenant-job:${opts.job}] tenant=${target.tenantCode} failed: ${error}`);
      outcomes.push({ tenantId: target.tenantId, tenantCode: target.tenantCode, ok: false, error });
    }
  }
  for (const s of skipped) {
    console.log(`[tenant-job:${opts.job}] tenant=${s.tenantCode} skipped: ${s.reason}`);
  }
  return { outcomes, skipped };
}
