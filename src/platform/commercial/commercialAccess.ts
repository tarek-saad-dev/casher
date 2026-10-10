import 'server-only';
import { getPool } from '@/lib/db';
import { evaluateLimit, loadTenantUsage } from './limits';
import { getPlan, getTenantSubscription, type SqlExecutor } from './planRepository';
import { evaluateSubscription } from './subscriptionLifecycle';
import type { CommercialAccessReport } from './types';

/**
 * Commercial policy for one tenant: subscription evaluation + limit usage.
 * Route-wide enforcement of this policy is DRVO-013 scope.
 */
export async function evaluateCommercialAccess(
  tenantId: string,
  opts: { executor?: SqlExecutor; now?: Date } = {},
): Promise<CommercialAccessReport> {
  const ex = opts.executor ?? (await getPool());
  const now = opts.now ?? new Date();
  const sub = await getTenantSubscription(ex, tenantId);
  const plan = sub ? await getPlan(ex, sub.planCode) : null;
  const usage = await loadTenantUsage(ex, tenantId);
  return {
    tenantId,
    planCode: sub?.planCode ?? null,
    subscription: evaluateSubscription(sub, plan, now),
    branches: evaluateLimit(plan ? plan.maxBranches : 0, usage.branches),
    users: evaluateLimit(plan ? plan.maxUsers : 0, usage.users),
  };
}
