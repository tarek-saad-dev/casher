import 'server-only';
import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import {
  acquireTenantApplock,
  TENANT_COMMERCIAL_LOCK_PARTS,
} from '@/platform/tenant/tenantApplock';
import { CommercialError } from './errors';
import { getPlan, getTenantSubscription, type SqlExecutor } from './planRepository';
import { evaluateSubscription } from './subscriptionLifecycle';
import type { LimitEvaluation, SubscriptionEvaluation } from './types';

/** Pure limit evaluation. null limit = unlimited. */
export function evaluateLimit(limit: number | null, usage: number, adding = 1): LimitEvaluation {
  if (limit == null) {
    return { limit: null, usage, canAdd: true, overLimit: false };
  }
  return {
    limit,
    usage,
    canAdd: usage + adding <= limit,
    overLimit: usage > limit,
  };
}

export type TenantUsage = { branches: number; users: number };

/** Usage = active Locations; memberships whose legacy user is not deleted. */
export async function loadTenantUsage(
  ex: SqlExecutor,
  tenantId: string,
  opts: { lock?: boolean } = {},
): Promise<TenantUsage> {
  const hint = opts.lock ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Location ${hint}
          WHERE TenantId = @tenantId AND Status = N'active') AS branches,
        (SELECT COUNT(*) FROM dbo.TenantMembership m ${hint}
          JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId
          WHERE m.TenantId = @tenantId AND ISNULL(u.isDeleted, 0) = 0) AS users;
    `);
  const row = result.recordset[0] as { branches: number; users: number };
  return { branches: Number(row.branches), users: Number(row.users) };
}

export type LimitDecision = {
  allowed: boolean;
  reason:
    | 'WITHIN_LIMIT'
    | 'UNLIMITED'
    | 'LIMIT_REACHED'
    | 'COMMERCIAL_ACCESS_BLOCKED';
  subscription: SubscriptionEvaluation;
  limit: LimitEvaluation;
};

async function decide(
  ex: SqlExecutor,
  tenantId: string,
  kind: 'branches' | 'users',
  now: Date,
  lock: boolean,
): Promise<LimitDecision> {
  const sub = await getTenantSubscription(ex, tenantId, { forUpdate: lock });
  const plan = sub ? await getPlan(ex, sub.planCode) : null;
  const subscription = evaluateSubscription(sub, plan, now);
  const usage = await loadTenantUsage(ex, tenantId, { lock });
  const limitValue = plan ? (kind === 'branches' ? plan.maxBranches : plan.maxUsers) : 0;
  const limit = evaluateLimit(limitValue, usage[kind]);

  if (!subscription.allowed) {
    return { allowed: false, reason: 'COMMERCIAL_ACCESS_BLOCKED', subscription, limit };
  }
  if (!limit.canAdd) {
    return { allowed: false, reason: 'LIMIT_REACHED', subscription, limit };
  }
  return {
    allowed: true,
    reason: limit.limit == null ? 'UNLIMITED' : 'WITHIN_LIMIT',
    subscription,
    limit,
  };
}

/** Read-only check. Use only where TenantId is authoritative. */
export async function canCreateBranch(
  tenantId: string,
  opts: { executor?: SqlExecutor; now?: Date } = {},
): Promise<LimitDecision> {
  const ex = opts.executor ?? (await getPool());
  return decide(ex, tenantId, 'branches', opts.now ?? new Date(), false);
}

/** Read-only check. Use only where TenantId is authoritative. */
export async function canCreateUser(
  tenantId: string,
  opts: { executor?: SqlExecutor; now?: Date } = {},
): Promise<LimitDecision> {
  const ex = opts.executor ?? (await getPool());
  return decide(ex, tenantId, 'users', opts.now ?? new Date(), false);
}

function throwForDecision(kind: 'branches' | 'users', tenantId: string, d: LimitDecision): never {
  if (d.reason === 'COMMERCIAL_ACCESS_BLOCKED') {
    throw new CommercialError(
      'COMMERCIAL_ACCESS_BLOCKED',
      `Tenant commercial access is blocked (${d.subscription.reason})`,
      403,
      { tenantId, subscription: d.subscription },
    );
  }
  throw new CommercialError(
    kind === 'branches' ? 'BRANCH_LIMIT_REACHED' : 'USER_LIMIT_REACHED',
    `Plan ${kind} limit reached (${d.limit.usage}/${d.limit.limit})`,
    409,
    { tenantId, limit: d.limit },
  );
}

/**
 * In-transaction guard: takes the tenant commercial applock and locks usage
 * so concurrent adds for the same tenant serialize. Caller inserts afterwards.
 */
export async function assertCanAddBranch(
  tx: Transaction,
  tenantId: string,
  now: Date = new Date(),
): Promise<LimitDecision> {
  await acquireTenantApplock(tx, tenantId, TENANT_COMMERCIAL_LOCK_PARTS);
  const d = await decide(tx, tenantId, 'branches', now, true);
  if (!d.allowed) throwForDecision('branches', tenantId, d);
  return d;
}

export async function assertCanAddUser(
  tx: Transaction,
  tenantId: string,
  now: Date = new Date(),
): Promise<LimitDecision> {
  await acquireTenantApplock(tx, tenantId, TENANT_COMMERCIAL_LOCK_PARTS);
  const d = await decide(tx, tenantId, 'users', now, true);
  if (!d.allowed) throwForDecision('users', tenantId, d);
  return d;
}
