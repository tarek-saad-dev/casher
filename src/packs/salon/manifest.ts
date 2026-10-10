import {
  APP_REGISTRY_CODES,
  OPERATIONS_SURFACE_CODE,
} from '@/platform/registry/constants';
import type { IndustryPackDefinition } from '@/platform/packs/types';

/**
 * Salon Pack — recipe, not a fork (DRVO-002, DRVO-012).
 * operations is a composition surface and is never an installed app.
 */
export const SALON_PACK_CODE = 'salon' as const;

export const SALON_PACK_SURFACES = [OPERATIONS_SURFACE_CODE] as const;

export const SALON_PACK: IndustryPackDefinition = {
  packCode: SALON_PACK_CODE,
  version: 1,
  displayName: 'Salon',
  required: ['booking'],
  recommended: ['queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports'],
  optional: ['inventory', 'purchasing', 'messaging', 'ai-receptionist'],
  configDefaults: {
    compositionSurfaces: [...SALON_PACK_SURFACES],
    bookingMode: 'appointments_and_walk_in',
  },
};

/**
 * CASHER_BOOT bootstrap compatibility manifest (DRVO-003 shape).
 * The bootstrap tenant keeps every registered app; derived from the registry,
 * never from a hardcoded count. New tenants use SALON_PACK instead.
 */
export function getBootstrapSalonManifest() {
  return {
    packCode: SALON_PACK_CODE,
    enabledApps: [...APP_REGISTRY_CODES],
    compositionSurfaces: [...SALON_PACK_SURFACES],
    extensions: ['cut-club'],
  };
}
