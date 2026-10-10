import 'server-only';
import { getPool } from '@/lib/db';
import { installedAppCodes, listTenantApps } from '@/platform/apps/tenantApps';
import {
  installedAppsGateMemo as appsMemo,
  subscriptionGateMemo as subscriptionMemo,
} from './accessGateMemo';
import { getPlan, getTenantSubscription } from './planRepository';
import { evaluateSubscription } from './subscriptionLifecycle';
import { resolveRouteAppCode } from './routeAppFamilies';
import { currentRequestPathname } from '@/platform/tenant/requestPathname';
import { resolvePublicTenantContext } from '@/platform/tenant/tenantContext';
import type { SubscriptionEvaluation } from './types';

export { invalidateTenantAccessGate, resetTenantAccessGate } from './accessGateMemo';

export type TenantAccessDeniedCode = 'SUBSCRIPTION_INACTIVE' | 'APP_NOT_INSTALLED';

export class TenantAccessDeniedError extends Error {
  readonly status = 403;
  constructor(
    readonly code: TenantAccessDeniedCode,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'TenantAccessDeniedError';
  }
}

/**
 * Commercial evaluation for an AUTHORITATIVE tenantId (from TenantContext). Missing subscription
 * evaluates to NO_SUBSCRIPTION (blocked); there is no fail-open.
 */
export async function evaluateTenantSubscriptionGate(
  tenantId: string,
  now: Date = new Date(),
): Promise<SubscriptionEvaluation> {
  return subscriptionMemo.getOrLoad(tenantId, [], async () => {
    const pool = await getPool();
    const sub = await getTenantSubscription(pool, tenantId);
    const plan = sub ? await getPlan(pool, sub.planCode) : null;
    return evaluateSubscription(sub, plan, now);
  });
}

export async function assertTenantSubscriptionActive(tenantId: string, now?: Date): Promise<SubscriptionEvaluation> {
  const evaluation = await evaluateTenantSubscriptionGate(tenantId, now);
  if (!evaluation.allowed) {
    throw new TenantAccessDeniedError(
      'SUBSCRIPTION_INACTIVE',
      'اشتراك المنشأة غير نشط',
      evaluation.reason,
    );
  }
  return evaluation;
}

export async function getTenantInstalledAppsForGate(tenantId: string): Promise<string[]> {
  return appsMemo.getOrLoad(tenantId, [], async () =>
    installedAppCodes(await listTenantApps(tenantId)),
  );
}

/** App entitlement for an AUTHORITATIVE tenantId. Disabled or never-installed apps are denied. */
export async function assertTenantAppInstalled(tenantId: string, appCode: string): Promise<void> {
  const installed = await getTenantInstalledAppsForGate(tenantId);
  if (!installed.includes(appCode)) {
    throw new TenantAccessDeniedError('APP_NOT_INSTALLED', 'هذا التطبيق غير مفعّل لهذه المنشأة', appCode);
  }
}

/**
 * Side effects keyed by a legacy branch (e.g. POS post-commit Loyalty earn): true only when the
 * branch is an active Location of exactly one active tenant AND that tenant has the app installed.
 * Any resolution failure answers false (fail closed).
 */
export async function isAppInstalledForBranchTenant(legacyBranchId: number, appCode: string): Promise<boolean> {
  try {
    const { tenantId } = await resolvePublicTenantContext({ legacyBranchId });
    return (await getTenantInstalledAppsForGate(tenantId)).includes(appCode);
  } catch (err) {
    console.warn(`[tenant-access-gate] ${appCode} skipped for branch ${legacyBranchId}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Route-family app gate (ROUTE_APP_FAMILIES) for the AUTHORITATIVE tenant of the current request.
 * `pathname` defaults to the proxy-stamped request path; core/shared routes resolve to no app.
 */
export async function assertRouteAppEntitlement(
  tenantId: string,
  pathname?: string | null,
): Promise<string | null> {
  const path = pathname === undefined ? await currentRequestPathname() : pathname;
  const app = resolveRouteAppCode(path);
  if (app) await assertTenantAppInstalled(tenantId, app);
  return app;
}
