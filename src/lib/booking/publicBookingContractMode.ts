/**
 * Booking Phase 7C2 — public contract compatibility vs enforce mode.
 * Mode is env-only; clients cannot override via query/body/header.
 */
import 'server-only';

export const PUBLIC_BOOKING_API_CONTRACT_VERSION = 'booking-public-v1';
export const PUBLIC_BOOKING_CONTRACT_VERSION_HEADER = 'X-Booking-Contract-Version';

export type PublicBookingContractMode = 'compat' | 'enforce';

export type ContractCompatibilityFlags = {
  legacyRequestAccepted: boolean;
  missingPlanToken?: boolean;
  missingIdempotencyKey?: boolean;
};

let warnedEnforce = false;

export function getPublicBookingContractMode(
  env: { PUBLIC_BOOKING_CONTRACT_MODE?: string; NODE_ENV?: string } = process.env,
): PublicBookingContractMode {
  const raw = String(env.PUBLIC_BOOKING_CONTRACT_MODE ?? 'compat')
    .trim()
    .toLowerCase();
  if (raw === 'enforce') {
    if (env.NODE_ENV === 'production' && !warnedEnforce) {
      console.warn(
        JSON.stringify({
          event: 'public_booking.contract_mode_enforce',
          message: 'PUBLIC_BOOKING_CONTRACT_MODE=enforce is active',
          timestamp: new Date().toISOString(),
        }),
      );
      warnedEnforce = true;
    }
    return 'enforce';
  }
  return 'compat';
}

export function isPublicBookingEnforceMode(
  env: { PUBLIC_BOOKING_CONTRACT_MODE?: string; NODE_ENV?: string } = process.env,
): boolean {
  return getPublicBookingContractMode(env) === 'enforce';
}

export function buildContractCompatibilityMetadata(
  flags: Omit<ContractCompatibilityFlags, 'legacyRequestAccepted'> & {
    legacyRequestAccepted?: boolean;
  },
): ContractCompatibilityFlags | null {
  const legacy =
    flags.legacyRequestAccepted ??
    Boolean(flags.missingPlanToken || flags.missingIdempotencyKey);
  if (!legacy) return null;
  return {
    legacyRequestAccepted: true,
    ...(flags.missingPlanToken ? { missingPlanToken: true } : {}),
    ...(flags.missingIdempotencyKey ? { missingIdempotencyKey: true } : {}),
  };
}

export function logLegacyContractUsed(args: {
  routeFamily: string;
  missingRequirement: 'planToken' | 'idempotencyKey' | 'both';
  requestId?: string | null;
  environment?: string;
}): void {
  console.info(
    JSON.stringify({
      event: 'public_booking.legacy_contract_used',
      routeFamily: args.routeFamily,
      missingRequirement: args.missingRequirement,
      requestId: args.requestId ?? null,
      environment: args.environment ?? process.env.NODE_ENV ?? null,
      timestamp: new Date().toISOString(),
    }),
  );
}

export const DEPRECATION_HEADERS: Record<string, string> = {
  Deprecation: 'true',
  Warning: '299 - "Legacy public booking request contract"',
};
