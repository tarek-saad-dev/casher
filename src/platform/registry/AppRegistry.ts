import {
  APP_REGISTRY_CODES,
  ENTITLEMENT_ENFORCEMENT_ENABLED,
  OPERATIONS_SURFACE_CODE,
} from './constants';
import type { AppRegistryEntry } from './types';

const DISPLAY_NAMES: Record<(typeof APP_REGISTRY_CODES)[number], string> = {
  booking: 'Booking',
  queue: 'Queue',
  pos: 'POS',
  inventory: 'Inventory',
  purchasing: 'Purchasing',
  attendance: 'Attendance',
  payroll: 'Payroll',
  treasury: 'Treasury',
  loyalty: 'Loyalty',
  messaging: 'Messaging',
  'ai-receptionist': 'AI Receptionist',
  reports: 'Reports',
};

/** Static registry metadata for DRVO-003 bootstrap. */
export function getAppRegistryEntries(): AppRegistryEntry[] {
  return APP_REGISTRY_CODES.map((appCode) => ({
    appCode,
    displayName: DISPLAY_NAMES[appCode],
    entitledSeparately: true,
  }));
}

export function getOperationsSurfaceEntry(): {
  appCode: typeof OPERATIONS_SURFACE_CODE;
  displayName: string;
  entitledSeparately: false;
} {
  return {
    appCode: OPERATIONS_SURFACE_CODE,
    displayName: 'Operations',
    entitledSeparately: false,
  };
}

/**
 * When enforcement is off (DRVO-003), every registered app is treated as enabled.
 */
export function isAppEnabledForTenant(
  _tenantId: string,
  _appCode: string,
  enabledInDb = true,
): boolean {
  if (!ENTITLEMENT_ENFORCEMENT_ENABLED) return true;
  return enabledInDb;
}
