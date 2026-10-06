import 'server-only';
import { getPool } from '@/lib/db';
import { installedAppCodes, listTenantApps } from '@/platform/apps/tenantApps';
import {
  installedAppsGateMemo as appsMemo,
  subscriptionGateMemo as subscriptionMemo,
} from './accessGateMemo';
import { getPlan, getTenantSubscription } from './planRepository';
import { evaluateSubscription } from './subscriptionLifecycle';
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
