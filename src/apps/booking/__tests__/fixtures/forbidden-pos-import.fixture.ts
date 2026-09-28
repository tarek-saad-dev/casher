/**
 * Boundary fixture: booking must not import POS app internals.
 */
import { createLegacyBookingConversionAdapter } from '@/apps/pos/internal/legacyBookingConversionAdapter';

export const FORBIDDEN_POS_IMPORT = createLegacyBookingConversionAdapter;
