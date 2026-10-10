import { describe, expect, it } from 'vitest';
import {
  APP_REGISTRY_CODES,
  ENTITLEMENT_ENFORCEMENT_ENABLED,
  getAppRegistryEntries,
  getOperationsSurfaceEntry,
  isAppEnabledForTenant,
} from '@/platform/public';
import { getBootstrapSalonManifest, SALON_PACK } from '@/packs/salon/public';

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

  it('keeps route-level entitlement enforcement off until DRVO-013', () => {
    expect(ENTITLEMENT_ENFORCEMENT_ENABLED).toBe(false);
    expect(isAppEnabledForTenant('tenant', 'pos', false)).toBe(true);
  });

  it('bootstrap compatibility manifest derives every registered app from the registry', () => {
    const manifest = getBootstrapSalonManifest();
    expect(manifest.enabledApps).toEqual([...APP_REGISTRY_CODES]);
    expect(manifest.compositionSurfaces).toEqual(['operations']);
  });

  it('salon pack references only installable app codes and never operations', () => {
    for (const code of [...SALON_PACK.required, ...SALON_PACK.recommended, ...SALON_PACK.optional]) {
      expect(APP_REGISTRY_CODES).toContain(code);
      expect(code).not.toBe('operations');
    }
  });
});
