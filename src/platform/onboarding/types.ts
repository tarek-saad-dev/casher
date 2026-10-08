import type { AppCustomizations, IndustryPackDefinition } from '@/platform/packs/types';

/** Optional brand fields captured at onboarding; display name and timezone default from the tenant. */
export type ProvisionTenantBrandInput = {
  logoUrl?: string | null;
  phone?: string | null;
  address?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  receiptFooter?: string | null;
  publicBookingOrigins?: string[];
};

export type ProvisionTenantInput = {
  tenantCode: string;
  tenantDisplayName: string;
  defaultTimezone: string;
  ownerUserName: string;
  ownerLoginName: string;
  ownerPassword: string;
  firstBranchCode: string;
  firstBranchName: string;
  branchAddress?: string | null;
  branchPhone?: string | null;
  branchDefaultOpenTime?: string | null;
  branchDefaultCloseTime?: string | null;
  /** Resolved Industry Pack definition (injected by the caller; platform does not import packs). */
  industryPack: IndustryPackDefinition;
  /** Customizations applied on top of the pack default app set. */
  appCustomizations?: AppCustomizations;
  /** Commercial plan; defaults to starter. */
  planCode?: string;
  /** Defaults to trial. */
  subscriptionStatus?: 'trial' | 'active';
  brand?: ProvisionTenantBrandInput;
};

export type ProvisionTenantActor = {
  actorUserId: number;
  actorUserName?: string;
};

export type ProvisionTenantResult = {
  tenantId: string;
  tenantCode: string;
  locationId: string;
  membershipId: string;
  legacyBranchId: number;
  legacyUserId: number;
  branchCode: string;
  ownerLoginName: string;
  ownerRole: string;
  industryPackCode: string;
  apps: string[];
  planCode: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  readiness: TenantReadinessReport;
};

export type ReadinessCheck = {
  id: string;
  pass: boolean;
  detail: string;
};

export type TenantReadinessReport = {
  tenantId: string;
  tenantCode: string;
  overall: 'PASS' | 'FAIL';
  checks: ReadinessCheck[];
};

export type TenantSummary = {
  tenantId: string;
  code: string;
  name: string;
  status: string;
  defaultTimezone: string;
  locationCount: number;
  userCount: number;
  planCode: string | null;
  subscriptionStatus: string | null;
  industryPackCode: string | null;
  createdAt: string;
};
