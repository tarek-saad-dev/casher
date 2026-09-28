import { describe, expect, it } from 'vitest';
import {
  APP_REGISTRY_CODES,
  ENTITLEMENT_ENFORCEMENT_ENABLED,
  getAppRegistryEntries,
  getOperationsSurfaceEntry,
  isAppEnabledForTenant,
} from '@/platform/public';
import { getSalonPackManifest } from '@/packs/salon/public';

describe('App registry + Salon manifest', () => {
  it('lists initial app codes from DRVO-002', () => {
    expect(APP_REGISTRY_CODES).toEqual([
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
    ]);
    expect(getAppRegistryEntries()).toHaveLength(APP_REGISTRY_CODES.length);
  });

  it('marks operations as not separately entitled', () => {
    expect(getOperationsSurfaceEntry().entitledSeparately).toBe(false);
  });

  it('keeps entitlement enforcement off in DRVO-003', () => {
    expect(ENTITLEMENT_ENFORCEMENT_ENABLED).toBe(false);
    expect(isAppEnabledForTenant('tenant', 'pos', false)).toBe(true);
  });

  it('salon manifest references only valid app codes plus operations surface', () => {
    const manifest = getSalonPackManifest();
    for (const code of manifest.enabledApps) {
      expect(APP_REGISTRY_CODES).toContain(code);
    }
    expect(manifest.compositionSurfaces).toEqual(['operations']);
  });
});
