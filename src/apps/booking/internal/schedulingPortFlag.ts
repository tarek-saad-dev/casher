import 'server-only';
import { isDrvoModuleExtractedPathEnabled } from '@/platform/drvo/featureFlags';

/**
 * DRVO-004 booking scheduling path gate.
 *
 * Normal authority: source-controlled `rollout` in moduleManifest.ts (currently legacy).
 * Env BOOKING_SCHEDULING_PORT is break-glass / compat only — see featureFlags.ts precedence.
 * DRVO_FORCE_BOOKING_PATH=legacy|extracted is the emergency override.
 */
export function isBookingSchedulingPortEnabled(): boolean {
  return isDrvoModuleExtractedPathEnabled('booking');
}
