import { describe, expect, it } from 'vitest';
import {
  computeTrialEnd,
  evaluateSubscription,
  nextSubscriptionStatus,
  SUBSCRIPTION_TRANSITIONS,
} from '@/platform/commercial/subscriptionLifecycle';
import type { TenantSubscriptionRecord } from '@/platform/commercial/types';
import { SUBSCRIPTION_STATUSES } from '@/platform/commercial/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-05T12:00:00.000Z');
const plan = { pastDueGraceDays: 7 };

function sub(over: Partial<TenantSubscriptionRecord>): TenantSubscriptionRecord {
  return {
    tenantId: '00000000-0000-0000-0000-000000000001',
    planCode: 'starter',
    status: 'active',
    origin: 'onboarding',
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    pastDueSince: null,
    suspendedAt: null,
    cancelledAt: null,
    revision: 1,
    ...over,
  };
}

describe('DRVO-012 subscription lifecycle evaluator', () => {
  it('uses canonical status language', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual(['trial', 'active', 'past_due', 'suspended', 'cancelled']);
  });

  it('valid trial is allowed; expired trial is blocked', () => {
    const valid = evaluateSubscription(
      sub({ status: 'trial', trialEndsAt: new Date(NOW.getTime() + DAY) }),
      plan,
      NOW,
    );
    expect(valid).toMatchObject({ allowed: true, status: 'trial', reason: 'TRIAL_VALID' });

    const expired = evaluateSubscription(
      sub({ status: 'trial', trialEndsAt: new Date(NOW.getTime() - 1) }),
      plan,
      NOW,
    );
    expect(expired).toMatchObject({ allowed: false, status: 'trial', reason: 'TRIAL_EXPIRED' });

    const boundary = evaluateSubscription(sub({ status: 'trial', trialEndsAt: NOW }), plan, NOW);
    expect(boundary.allowed).toBe(false);
  });

  it('active is allowed, including grandfathered rows with no period end', () => {
    expect(evaluateSubscription(sub({ status: 'active' }), plan, NOW)).toMatchObject({
      allowed: true,
      reason: 'ACTIVE',
    });
    expect(
      evaluateSubscription(
        sub({ status: 'active', origin: 'migration_grandfathered', planCode: 'internal' }),
        plan,
        new Date('2099-01-01T00:00:00Z'),
      ).allowed,
    ).toBe(true);
  });

  it('past_due inside grace is allowed with warning; after grace is blocked', () => {
    const inside = evaluateSubscription(
      sub({ status: 'past_due', pastDueSince: new Date(NOW.getTime() - 6 * DAY) }),
      plan,
      NOW,
    );
    expect(inside).toMatchObject({
      allowed: true,
      reason: 'PAST_DUE_IN_GRACE',
      warning: 'PAST_DUE_GRACE',
    });

    const after = evaluateSubscription(
      sub({ status: 'past_due', pastDueSince: new Date(NOW.getTime() - 8 * DAY) }),
      plan,
      NOW,
    );
    expect(after).toMatchObject({ allowed: false, reason: 'PAST_DUE_GRACE_EXCEEDED' });
    expect(after.warning).toBeUndefined();
  });

  it('suspended is blocked', () => {
    expect(evaluateSubscription(sub({ status: 'suspended', suspendedAt: NOW }), plan, NOW)).toMatchObject(
      { allowed: false, reason: 'SUSPENDED' },
    );
  });

  it('cancelled follows the V1 paid-period rule then blocks', () => {
    const inPeriod = evaluateSubscription(
      sub({ status: 'cancelled', cancelledAt: NOW, currentPeriodEndsAt: new Date(NOW.getTime() + DAY) }),
      plan,
      NOW,
    );
    expect(inPeriod).toMatchObject({
      allowed: true,
      reason: 'CANCELLED_UNTIL_PERIOD_END',
      warning: 'CANCELLED_UNTIL_PERIOD_END',
    });

    const afterPeriod = evaluateSubscription(
      sub({ status: 'cancelled', cancelledAt: NOW, currentPeriodEndsAt: new Date(NOW.getTime() - DAY) }),
      plan,
      NOW,
    );
    expect(afterPeriod).toMatchObject({ allowed: false, reason: 'CANCELLED' });

    const cancelledTrial = evaluateSubscription(
      sub({ status: 'cancelled', cancelledAt: NOW, trialEndsAt: new Date(NOW.getTime() + DAY) }),
      plan,
      NOW,
    );
    expect(cancelledTrial).toMatchObject({ allowed: false, reason: 'CANCELLED' });
  });

  it('missing subscription or plan is blocked deterministically', () => {
    expect(evaluateSubscription(null, plan, NOW)).toEqual({
      allowed: false,
      status: null,
      reason: 'NO_SUBSCRIPTION',
    });
    expect(evaluateSubscription(sub({}), null, NOW)).toMatchObject({
      allowed: false,
      reason: 'PLAN_NOT_FOUND',
    });
  });

  it('never returns an undefined restricted mode', () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      const result = evaluateSubscription(
        sub({ status, trialEndsAt: NOW, pastDueSince: NOW }),
        plan,
        NOW,
      );
      expect(typeof result.allowed).toBe('boolean');
      expect(JSON.stringify(result)).not.toContain('restricted');
    }
  });

  it('computes trial end from plan trial days', () => {
    expect(computeTrialEnd(NOW, 14).toISOString()).toBe(new Date(NOW.getTime() + 14 * DAY).toISOString());
  });
});

describe('DRVO-012 subscription transitions', () => {
  it('allows only documented transitions', () => {
    expect(nextSubscriptionStatus('trial', 'activate')).toBe('active');
    expect(nextSubscriptionStatus('active', 'mark_past_due')).toBe('past_due');
    expect(nextSubscriptionStatus('past_due', 'activate')).toBe('active');
    expect(nextSubscriptionStatus('active', 'suspend')).toBe('suspended');
    expect(nextSubscriptionStatus('suspended', 'reactivate')).toBe('active');
    expect(nextSubscriptionStatus('active', 'cancel')).toBe('cancelled');
    expect(nextSubscriptionStatus('cancelled', 'reactivate')).toBe('active');

    expect(nextSubscriptionStatus('trial', 'mark_past_due')).toBeNull();
    expect(nextSubscriptionStatus('cancelled', 'suspend')).toBeNull();
    expect(nextSubscriptionStatus('active', 'activate')).toBeNull();
    expect(nextSubscriptionStatus('suspended', 'mark_past_due')).toBeNull();
  });

  it('every transition targets a canonical status', () => {
    for (const rule of Object.values(SUBSCRIPTION_TRANSITIONS)) {
      expect(SUBSCRIPTION_STATUSES).toContain(rule.to);
    }
  });
});
