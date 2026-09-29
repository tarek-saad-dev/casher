/**
 * Boundary fixture: queue must not import booking app internals.
 */
import { createBooking } from '@/apps/booking/application/createBooking';

export const FORBIDDEN_BOOKING_IMPORT = createBooking;
