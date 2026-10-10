export const SUBSCRIPTION_STATUSES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionOrigin = 'migration_grandfathered' | 'onboarding' | 'platform_admin';

/** Plans tenants may be onboarded onto by default. `internal` is not public. */
export const DEFAULT_ONBOARDING_PLAN_CODE = 'starter';

export interface SaaSPlanRecord {
  planCode: string;
  displayName: string;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  /** null = unlimited. Provisional, editable data — not a pricing promise. */
  maxBranches: number | null;
  /** null = unlimited. Provisional, editable data — not a pricing promise. */
  maxUsers: number | null;
  trialDays: number;
  pastDueGraceDays: number;
}

export interface TenantSubscriptionRecord {
  tenantId: string;
  planCode: string;
  status: SubscriptionStatus;
  origin: SubscriptionOrigin;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  pastDueSince: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  revision: number;
}

export type CommercialReason =
  | 'TRIAL_VALID'
  | 'TRIAL_EXPIRED'
  | 'ACTIVE'
  | 'PAST_DUE_IN_GRACE'
  | 'PAST_DUE_GRACE_EXCEEDED'
  | 'SUSPENDED'
  | 'CANCELLED_UNTIL_PERIOD_END'
  | 'CANCELLED'
  | 'NO_SUBSCRIPTION'
  | 'PLAN_NOT_FOUND';

export type CommercialWarning = 'PAST_DUE_GRACE' | 'CANCELLED_UNTIL_PERIOD_END';

export interface SubscriptionEvaluation {
  allowed: boolean;
  status: SubscriptionStatus | null;
  reason: CommercialReason;
  warning?: CommercialWarning;
  /** When the current allowance ends, if bounded. */
  accessEndsAt?: string | null;
}

export interface LimitEvaluation {
  limit: number | null;
  usage: number;
  /** True when one more unit can be added. */
  canAdd: boolean;
  /** True when usage already exceeds the limit (e.g. after a downgrade). */
  overLimit: boolean;
}

export interface CommercialAccessReport {
  tenantId: string;
  planCode: string | null;
  subscription: SubscriptionEvaluation;
  branches: LimitEvaluation;
  users: LimitEvaluation;
}
