/**
 * Booking V2 B6 — feature flags for slot claim dual-guard.
 *
 * BOOKING_V2_SLOT_CLAIMS_MODE=
 *   off      — disabled (default)
 *   shadow   — write/attempt claims; conflicts logged; request still uses legacy locks
 *   enforce  — claim conflicts fail the request (legacy applock+assert still run)
 */

export type BookingSlotClaimsMode = 'off' | 'shadow' | 'enforce';

export function resolveBookingSlotClaimsMode(
  env: NodeJS.ProcessEnv = process.env,
): BookingSlotClaimsMode {
  const raw = String(env.BOOKING_V2_SLOT_CLAIMS_MODE ?? 'off')
    .trim()
    .toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (
    raw === 'enforce' ||
    raw === 'on' ||
    raw === '1' ||
    raw === 'true' ||
    raw === 'dual'
  ) {
    return 'enforce';
  }
  return 'off';
}

export function isBookingSlotClaimsEnabled(mode = resolveBookingSlotClaimsMode()): boolean {
  return mode === 'shadow' || mode === 'enforce';
}

export function isBookingSlotClaimsEnforced(mode = resolveBookingSlotClaimsMode()): boolean {
  return mode === 'enforce';
}
