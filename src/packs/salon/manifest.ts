import {
  APP_REGISTRY_CODES,
  OPERATIONS_SURFACE_CODE,
} from '@/platform/registry/constants';

/**
 * Salon Pack manifest — recipe, not a fork (DRVO-002).
 * operations is a composition surface and is not separately entitled.
 */
export const SALON_PACK_CODE = 'salon' as const;

export const SALON_PACK_ENABLED_APPS = [...APP_REGISTRY_CODES] as const;

export const SALON_PACK_SURFACES = [OPERATIONS_SURFACE_CODE] as const;

export function getSalonPackManifest() {
  return {
    packCode: SALON_PACK_CODE,
    enabledApps: SALON_PACK_ENABLED_APPS,
    compositionSurfaces: SALON_PACK_SURFACES,
    extensions: ['cut-club'],
  };
}
