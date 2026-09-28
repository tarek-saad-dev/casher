import type { AppRegistryCode } from './constants';

export interface AppRegistryEntry {
  appCode: AppRegistryCode;
  displayName: string;
  entitledSeparately: boolean;
}

export interface TenantAppEntitlement {
  tenantId: string;
  appCode: string;
  enabled: boolean;
}
