import 'server-only';
import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import { publishPlatformOutboxEvent } from '@/platform/outbox/publisher';
import {
  acquireTenantApplock,
  TENANT_COMMERCIAL_LOCK_PARTS,
} from '@/platform/tenant/tenantApplock';
import { invalidateTenantAccessGate } from './accessGateMemo';
import { assertNotBootstrapTenant } from './bootstrapGuard';
import { CommercialError } from './errors';
import { getPlan, getTenantSubscription, tenantExists } from './planRepository';
import {
  computeTrialEnd,
  isSubscriptionAction,
  nextSubscriptionStatus,
  type SubscriptionAction,
} from './subscriptionLifecycle';
import type { SaaSPlanRecord, TenantSubscriptionRecord } from './types';

export type SubscriptionActor = { actorUserId: number };

/** Plans a tenant may be onboarded onto: public and active. */
export async function resolveOnboardingPlan(
  tx: Transaction,
  planCode: string,
): Promise<SaaSPlanRecord> {
  const plan = await getPlan(tx, planCode);
  if (!plan) {
    throw new CommercialError('PLAN_NOT_FOUND', `Unknown plan: ${planCode}`, 400);
  }
  if (!plan.isActive || !plan.isPublic) {
    throw new CommercialError(
      'PLAN_NOT_ASSIGNABLE',
      `Plan ${planCode} cannot be assigned during onboarding`,
      400,
    );
  }
  return plan;
}

/**
 * Create the subscription for a newly provisioned tenant (DRVO-012 onboarding).
 * Default: trial on the selected plan. Pre-existing tenants are grandfathered by
 * the migration and never pass through here.
 */
export async function createOnboardingSubscriptionInTransaction(
  tx: Transaction,
  args: {
    tenantId: string;
    plan: SaaSPlanRecord;
    status: 'trial' | 'active';
    now: Date;
    actor: SubscriptionActor;
  },
): Promise<TenantSubscriptionRecord> {
  const { tenantId, plan, status, now } = args;
  if (status === 'trial' && plan.trialDays <= 0) {
    throw new CommercialError(
      'TRIAL_NOT_AVAILABLE',
      `Plan ${plan.planCode} has no trial period`,
      400,
    );
  }
  const existing = await getTenantSubscription(tx, tenantId, { forUpdate: true });
  if (existing) {
    throw new CommercialError('SUBSCRIPTION_EXISTS', 'Tenant already has a subscription', 409);
  }

  const trialEndsAt = status === 'trial' ? computeTrialEnd(now, plan.trialDays) : null;
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('planCode', sql.NVarChar(32), plan.planCode)
    .input('status', sql.NVarChar(20), status)
    .input('trialStartedAt', sql.DateTime2, status === 'trial' ? now : null)
    .input('trialEndsAt', sql.DateTime2, trialEndsAt)
    .query(`
      INSERT INTO dbo.TenantSubscription (
        TenantId, PlanCode, Status, Origin, TrialStartedAt, TrialEndsAt, Revision
      )
      VALUES (@tenantId, @planCode, @status, N'onboarding', @trialStartedAt, @trialEndsAt, 1);
    `);

  await publishPlatformOutboxEvent(tx, {
    tenantId,
    aggregateType: 'tenant_subscription',
    aggregateId: tenantId,
    eventType: 'tenant.subscription.created',
    payload: JSON.stringify({
      planCode: plan.planCode,
      status,
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      actorUserId: args.actor.actorUserId,
    }),
    idempotencyKey: `subscription:${tenantId}:rev:1`,
    correlationId: `tenant-subscription:${tenantId}`,
    occurredAt: now,
  });

  const created = await getTenantSubscription(tx, tenantId);
  if (!created) throw new Error('Subscription insert did not persist');
  return created;
}

async function withTenantCommercialTx<T>(
  tenantId: string,
  operation: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    if (!(await tenantExists(tx, tenantId))) {
      throw new CommercialError('TENANT_NOT_FOUND', 'Tenant not found', 404);
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

function assertRevision(sub: TenantSubscriptionRecord, expected: number | undefined): void {
  if (expected != null && expected !== sub.revision) {
    throw new CommercialError(
      'REVISION_CONFLICT',
      `Subscription revision is ${sub.revision}, expected ${expected}`,
      409,
      { revision: sub.revision },
    );
  }
}

/** Change commercial plan. Never touches installed apps. */
export async function changeTenantPlan(
  tenantId: string,
  planCode: string,
  opts: { actor: SubscriptionActor; expectedRevision?: number; now?: Date },
): Promise<TenantSubscriptionRecord> {
  const now = opts.now ?? new Date();
  return withTenantCommercialTx(tenantId, 'changeTenantPlan', async (tx) => {
    const sub = await getTenantSubscription(tx, tenantId, { forUpdate: true });
    if (!sub) throw new CommercialError('SUBSCRIPTION_NOT_FOUND', 'Tenant has no subscription', 404);
    assertRevision(sub, opts.expectedRevision);

    const plan = await getPlan(tx, planCode);
    if (!plan) throw new CommercialError('PLAN_NOT_FOUND', `Unknown plan: ${planCode}`, 400);
    if (!plan.isActive) {
      throw new CommercialError('PLAN_NOT_ASSIGNABLE', `Plan ${planCode} is not active`, 400);
    }
    if (plan.planCode === sub.planCode) return sub;

    const revision = sub.revision + 1;
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('planCode', sql.NVarChar(32), plan.planCode)
      .input('revision', sql.Int, revision)
      .input('prevRevision', sql.Int, sub.revision)
      .input('now', sql.DateTime2, now)
      .query(`
        UPDATE dbo.TenantSubscription
        SET PlanCode = @planCode, Origin = N'platform_admin',
            Revision = @revision, UpdatedAt = @now
        WHERE TenantId = @tenantId AND Revision = @prevRevision;
      `);

    await publishPlatformOutboxEvent(tx, {
      tenantId,
      aggregateType: 'tenant_subscription',
      aggregateId: tenantId,
      eventType: 'tenant.subscription.plan_changed',
      payload: JSON.stringify({
        fromPlanCode: sub.planCode,
        toPlanCode: plan.planCode,
        status: sub.status,
        installedAppsChanged: false,
        actorUserId: opts.actor.actorUserId,
      }),
      idempotencyKey: `subscription:${tenantId}:rev:${revision}`,
      correlationId: `tenant-subscription:${tenantId}`,
      occurredAt: now,
    });

    const updated = await getTenantSubscription(tx, tenantId);
    if (!updated) throw new Error('Subscription disappeared during plan change');
    return updated;
  });
}

/** Explicit lifecycle transition (activate, mark_past_due, suspend, cancel, reactivate). */
export async function transitionTenantSubscription(
  tenantId: string,
  action: string,
  opts: {
    actor: SubscriptionActor;
    expectedRevision?: number;
    now?: Date;
    /** Paid-period end for activate/reactivate; kept on cancel from trial/active, capped at now from suspended/past_due. */
    currentPeriodEndsAt?: Date | null;
  },
): Promise<TenantSubscriptionRecord> {
  if (!isSubscriptionAction(action)) {
    throw new CommercialError('INVALID_ACTION', `Unknown subscription action: ${action}`, 400);
  }
  const typedAction: SubscriptionAction = action;
  const now = opts.now ?? new Date();

  return withTenantCommercialTx(tenantId, 'transitionTenantSubscription', async (tx) => {
    const sub = await getTenantSubscription(tx, tenantId, { forUpdate: true });
    if (!sub) throw new CommercialError('SUBSCRIPTION_NOT_FOUND', 'Tenant has no subscription', 404);
    assertRevision(sub, opts.expectedRevision);

    const next = nextSubscriptionStatus(sub.status, typedAction);
    if (!next) {
      throw new CommercialError(
        'INVALID_TRANSITION',
        `Cannot ${typedAction} a subscription in status ${sub.status}`,
        409,
        { status: sub.status, action: typedAction },
      );
    }

    let periodEnd = sub.currentPeriodEndsAt;
    let pastDueSince = sub.pastDueSince;
    let suspendedAt = sub.suspendedAt;
    let cancelledAt = sub.cancelledAt;
    switch (typedAction) {
      case 'activate':
      case 'reactivate':
        if (opts.currentPeriodEndsAt !== undefined) periodEnd = opts.currentPeriodEndsAt;
        pastDueSince = null;
        suspendedAt = null;
        cancelledAt = null;
        break;
      case 'mark_past_due':
        pastDueSince = now;
        break;
      case 'suspend':
        suspendedAt = now;
        break;
      case 'cancel':
        cancelledAt = now;
        // Paid-period allowance applies only to a subscription in good standing; cancelling a
        // suspended or past-due subscription must not re-grant access until the old period end.
        if ((sub.status === 'suspended' || sub.status === 'past_due') && (!periodEnd || periodEnd > now)) {
          periodEnd = now;
        }
        break;
    }

    const revision = sub.revision + 1;
    await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('status', sql.NVarChar(20), next)
      .input('periodEnd', sql.DateTime2, periodEnd)
      .input('pastDueSince', sql.DateTime2, pastDueSince)
      .input('suspendedAt', sql.DateTime2, suspendedAt)
      .input('cancelledAt', sql.DateTime2, cancelledAt)
      .input('revision', sql.Int, revision)
      .input('prevRevision', sql.Int, sub.revision)
      .input('now', sql.DateTime2, now)
      .query(`
        UPDATE dbo.TenantSubscription
        SET Status = @status, CurrentPeriodEndsAt = @periodEnd, PastDueSince = @pastDueSince,
            SuspendedAt = @suspendedAt, CancelledAt = @cancelledAt, Origin = N'platform_admin',
            Revision = @revision, UpdatedAt = @now
        WHERE TenantId = @tenantId AND Revision = @prevRevision;
      `);

    await publishPlatformOutboxEvent(tx, {
      tenantId,
      aggregateType: 'tenant_subscription',
      aggregateId: tenantId,
      eventType: 'tenant.subscription.status_changed',
      payload: JSON.stringify({
        action: typedAction,
        fromStatus: sub.status,
        toStatus: next,
        planCode: sub.planCode,
        currentPeriodEndsAt: periodEnd?.toISOString() ?? null,
        actorUserId: opts.actor.actorUserId,
      }),
      idempotencyKey: `subscription:${tenantId}:rev:${revision}`,
      correlationId: `tenant-subscription:${tenantId}`,
      occurredAt: now,
    });

    const updated = await getTenantSubscription(tx, tenantId);
    if (!updated) throw new Error('Subscription disappeared during transition');
    return updated;
  });
}
