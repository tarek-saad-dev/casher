/** Initial app registry codes (DRVO-002 §8). */
export const APP_REGISTRY_CODES = [
  'booking',
  'queue',
  'pos',
  'inventory',
  'purchasing',
  'attendance',
  'payroll',
  'treasury',
  'loyalty',
  'messaging',
  'ai-receptionist',
  'reports',
] as const;

export type AppRegistryCode = (typeof APP_REGISTRY_CODES)[number];

/** Composition surface — not separately entitled. */
export const OPERATIONS_SURFACE_CODE = 'operations' as const;

export const ALL_KNOWN_APP_CODES = [
  ...APP_REGISTRY_CODES,
  OPERATIONS_SURFACE_CODE,
] as const;

/** DRVO-003: entitlement enforcement remains off. */
export const ENTITLEMENT_ENFORCEMENT_ENABLED = false;
