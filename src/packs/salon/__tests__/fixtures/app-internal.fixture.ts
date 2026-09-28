/**
 * Boundary fixture: a pack must not import an app internal path.
 * Resolved path is `apps/.../internal/...` (no leading slash).
 * Not imported by production code. Scanned only by the boundary test.
 */
import { createLegacyMoneyMovementAdapter } from '@/apps/treasury/internal/legacyMoneyMovementAdapter';

export const PACK_INTERNAL_FIXTURE = createLegacyMoneyMovementAdapter;
