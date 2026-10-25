import type { SaaSPlanRecord, TenantSubscriptionRecord } from './types';
import { DRVO_PLAN_PRICING, getPlanPricing, type PublicPlanCode } from './pricingCatalog';

export type BillingCycle = 'monthly' | 'annual';
export type PlanRequestStatus = 'pending' | 'contacted' | 'rejected' | 'cancelled';
export type PlanQuote = {
  planCode: PublicPlanCode;
  billingCycle: BillingCycle;
  amountEgp: number;
  currency: 'EGP';
  fromPlanCode: string;
  subscriptionRevision: number;
};

export class PlanRequestError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = 'PlanRequestError';
  }
}

/** Billing amounts are ALWAYS calculated by the server, never trusted from client payloads. */
export function quoteTenantPlan(
  planCode: string,
  billingCycle: string,
  current: Pick<TenantSubscriptionRecord, 'planCode' | 'revision'>,
  dbPlan: Pick<SaaSPlanRecord, 'planCode' | 'isPublic' | 'isActive'> | null,
): PlanQuote {
  const offer = getPlanPricing(planCode);
  if (!offer || !dbPlan || !dbPlan.isPublic || !dbPlan.isActive || dbPlan.planCode !== planCode) {
    throw new PlanRequestError('PLAN_UNAVAILABLE', 'الباقة مش متاحة للاشتراك حاليًا');
  }
  if (billingCycle !== 'monthly' && billingCycle !== 'annual') {
    throw new PlanRequestError('BILLING_CYCLE_INVALID', 'اختار شهري أو سنوي');
  }
  if (!Number.isSafeInteger(current.revision) || current.revision < 1) {
    throw new PlanRequestError('SUBSCRIPTION_INVALID', 'بيانات الاشتراك غير مكتملة', 409);
  }
  return {
    planCode: offer.planCode,
    billingCycle,
    amountEgp: billingCycle === 'annual' ? offer.annualPrice : offer.monthlyPrice,
    currency: 'EGP',
    fromPlanCode: current.planCode,
    subscriptionRevision: current.revision,
  };
}

export function availablePlanOffers(plans: readonly SaaSPlanRecord[]) {
  const byCode = new Map(plans.map((p) => [p.planCode, p]));
  return DRVO_PLAN_PRICING.flatMap((price) => {
    const plan = byCode.get(price.planCode);
    return plan?.isActive && plan.isPublic
      ? [{ ...price, maxBranches: plan.maxBranches, maxUsers: plan.maxUsers }]
      : [];
  });
}
