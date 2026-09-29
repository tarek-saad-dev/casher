import 'server-only';
import { isStrictOptInEnvFlag } from '@/platform/drvo/featureFlags';

/**
 * DRVO-004 rollout gate (strict opt-in).
 * Extracted path runs only when BOOKING_SCHEDULING_PORT=true (exact literal).
 * Unset / false / malformed keeps legacy src/lib/booking paths.
 */
export function isBookingSchedulingPortEnabled(): boolean {
  return isStrictOptInEnvFlag(process.env.BOOKING_SCHEDULING_PORT);
}
