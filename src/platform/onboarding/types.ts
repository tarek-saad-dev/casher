export type ProvisionTenantInput = {
  tenantCode: string;
  tenantDisplayName: string;
  defaultTimezone: string;
  ownerUserName: string;
  ownerLoginName: string;
  ownerPassword: string;
  ownerUserLevel?: string;
  firstBranchCode: string;
  firstBranchName: string;
  branchAddress?: string | null;
  branchPhone?: string | null;
  branchDefaultOpenTime?: string | null;
  branchDefaultCloseTime?: string | null;
  packCode?: string;
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
  createdAt: string;
};
