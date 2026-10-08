import type { TenantBrandProfile } from '@/platform/branding/brandProfile';
import type { SubscriptionEvaluation, SubscriptionStatus } from '@/platform/commercial/types';

/** Read-only state the tenant UI shell renders (brand, apps, subscription banner / block). */
export interface TenantShellSnapshot {
  tenant: { tenantId: string; code: string; name: string; industryPackCode: string | null };
  brand: TenantBrandProfile;
  installedApps: string[];
  subscription: {
    allowed: boolean;
    status: SubscriptionStatus | null;
    reason: SubscriptionEvaluation['reason'];
    warning: SubscriptionEvaluation['warning'] | null;
    accessEndsAt: string | null;
    planCode: string | null;
    planName: string | null;
    trialEndsAt: string | null;
    pastDueSince: string | null;
    currentPeriodEndsAt: string | null;
  };
  isPlatformOperator: boolean;
}
