import type {
  SaaSPlanRecord,
  SubscriptionEvaluation,
  SubscriptionStatus,
  TenantSubscriptionRecord,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/**
 * Pure, deterministic commercial evaluation (DRVO-012 V1 policy).
 *
 * - trial: allowed until TrialEndsAt, then blocked.
 * - active: allowed (grandfathered rows have no period end).
 * - past_due: allowed with warning inside PastDueSince + plan grace, then blocked.
 * - suspended: blocked.
 * - cancelled (V1 paid-period rule): allowed with warning while CurrentPeriodEndsAt
 *   is in the future, otherwise blocked. A cancelled trial has no paid period.
 */
export function evaluateSubscription(
  sub: TenantSubscriptionRecord | null,
  plan: Pick<SaaSPlanRecord, 'pastDueGraceDays'> | null,
  now: Date,
): SubscriptionEvaluation {
  if (!sub) {
    return { allowed: false, status: null, reason: 'NO_SUBSCRIPTION' };
  }
  if (!plan) {
    return { allowed: false, status: sub.status, reason: 'PLAN_NOT_FOUND' };
  }

  const t = now.getTime();
  switch (sub.status) {
    case 'trial': {
      const ends = sub.trialEndsAt;
      if (ends && t < ends.getTime()) {
        return { allowed: true, status: 'trial', reason: 'TRIAL_VALID', accessEndsAt: iso(ends) };
      }
      return { allowed: false, status: 'trial', reason: 'TRIAL_EXPIRED', accessEndsAt: iso(ends) };
    }
    case 'active':
      return {
        allowed: true,
        status: 'active',
        reason: 'ACTIVE',
        accessEndsAt: iso(sub.currentPeriodEndsAt),
      };
    case 'past_due': {
      const since = sub.pastDueSince ?? now;
      const graceEnds = new Date(since.getTime() + Math.max(0, plan.pastDueGraceDays) * DAY_MS);
      if (t < graceEnds.getTime()) {
        return {
          allowed: true,
          status: 'past_due',
          reason: 'PAST_DUE_IN_GRACE',
          warning: 'PAST_DUE_GRACE',
          accessEndsAt: graceEnds.toISOString(),
        };
      }
      return {
        allowed: false,
        status: 'past_due',
        reason: 'PAST_DUE_GRACE_EXCEEDED',
        accessEndsAt: graceEnds.toISOString(),
      };
    }
    case 'suspended':
      return { allowed: false, status: 'suspended', reason: 'SUSPENDED' };
    case 'cancelled': {
      const periodEnd = sub.currentPeriodEndsAt;
      if (periodEnd && t < periodEnd.getTime()) {
        return {
          allowed: true,
          status: 'cancelled',
          reason: 'CANCELLED_UNTIL_PERIOD_END',
          warning: 'CANCELLED_UNTIL_PERIOD_END',
          accessEndsAt: periodEnd.toISOString(),
        };
      }
      return { allowed: false, status: 'cancelled', reason: 'CANCELLED', accessEndsAt: iso(periodEnd) };
    }
    default: {
      const unknown: never = sub.status;
      throw new Error(`Unknown subscription status: ${String(unknown)}`);
    }
  }
}

export type SubscriptionAction =
  | 'activate'
  | 'mark_past_due'
  | 'suspend'
  | 'cancel'
  | 'reactivate';

/** Allowed explicit transitions. Trial expiry is time-derived, not a transition. */
export const SUBSCRIPTION_TRANSITIONS: Record<
  SubscriptionAction,
  { from: readonly SubscriptionStatus[]; to: SubscriptionStatus }
> = {
  activate: { from: ['trial', 'past_due'], to: 'active' },
  mark_past_due: { from: ['active'], to: 'past_due' },
  suspend: { from: ['trial', 'active', 'past_due'], to: 'suspended' },
  cancel: { from: ['trial', 'active', 'past_due', 'suspended'], to: 'cancelled' },
  reactivate: { from: ['suspended', 'cancelled'], to: 'active' },
};

export function isSubscriptionAction(value: string): value is SubscriptionAction {
  return Object.prototype.hasOwnProperty.call(SUBSCRIPTION_TRANSITIONS, value);
}

export function nextSubscriptionStatus(
  current: SubscriptionStatus,
  action: SubscriptionAction,
): SubscriptionStatus | null {
  const rule = SUBSCRIPTION_TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}

export function computeTrialEnd(start: Date, trialDays: number): Date {
  return new Date(start.getTime() + Math.max(0, trialDays) * DAY_MS);
}
