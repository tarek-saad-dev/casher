import { TenantScopedMemo } from '@/platform/tenant/tenantMemo';
import type { SubscriptionEvaluation } from './types';

/** Short-lived per-process memo; platform mutations invalidate their tenant after commit. */
export const ACCESS_GATE_TTL_MS = 15_000;
export const subscriptionGateMemo = new TenantScopedMemo<SubscriptionEvaluation>(
  'commercial-gate',
  ACCESS_GATE_TTL_MS,
);
export const installedAppsGateMemo = new TenantScopedMemo<string[]>(
  'installed-apps-gate',
  ACCESS_GATE_TTL_MS,
);

export function invalidateTenantAccessGate(tenantId: string): void {
  subscriptionGateMemo.invalidateTenant(tenantId);
  installedAppsGateMemo.invalidateTenant(tenantId);
}

/** Test-only. */
export function resetTenantAccessGate(): void {
  subscriptionGateMemo.clear();
  installedAppsGateMemo.clear();
}
