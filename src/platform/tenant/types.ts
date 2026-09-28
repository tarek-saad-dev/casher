export type TenantStatus = 'active' | 'suspended';
export type LocationStatus = 'active' | 'suspended';

export interface TenantRecord {
  tenantId: string;
  code: string;
  name: string;
  status: TenantStatus;
  defaultTimezone: string;
}

export interface LocationRecord {
  locationId: string;
  tenantId: string;
  legacyBranchId: number;
  branchCode: string;
  timezone: string;
  status: LocationStatus;
}

export interface LegacyIdMapRecord {
  tenantId: string;
  entityName: string;
  legacyKey: string;
  drvoId: string;
}

export interface TenantMembershipRecord {
  membershipId: string;
  tenantId: string;
  legacyUserId: number;
}

/** Bootstrap tenant code — not a location code (GLEEM is a location). */
export const BOOTSTRAP_TENANT_CODE = 'CASHER_BOOT';
