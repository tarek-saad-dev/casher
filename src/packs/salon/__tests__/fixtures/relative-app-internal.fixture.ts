/**
 * Boundary fixture: a relative import (not `@/`) of an app internal path.
 * Not imported by production code. Scanned only by the boundary test.
 */
import { createLegacyMoneyMovementAdapter } from '../../../../apps/treasury/internal/legacyMoneyMovementAdapter';

export const RELATIVE_PACK_INTERNAL_FIXTURE = createLegacyMoneyMovementAdapter;
