import 'server-only';

/**
 * DRVO-004 rollout gate. Default on after extraction; set BOOKING_SCHEDULING_PORT=false
 * to route handlers back to legacy src/lib/booking paths.
 */
export function isBookingSchedulingPortEnabled(): boolean {
  return process.env.BOOKING_SCHEDULING_PORT !== 'false';
}
