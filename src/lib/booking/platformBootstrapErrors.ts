import 'server-only';

/**
 * Maps DRVO-003/platform prerequisite failures that currently collapse into
 * BOOKING_CREATE_FAILED / HOLD_FAILED so operators see the real cause in logs.
 *
 * Public clients must NEVER receive raw SQL / table names — only PLATFORM_BOOTSTRAP_REQUIRED.
 */
export function isPlatformBootstrapFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg === 'BOOTSTRAP_TENANT_NOT_FOUND') return true;
  if (/Invalid object name ['"]?dbo\.(Tenant|Location|TenantMembership|LegacyIdMap|PlatformOutbox|AppRegistry|TenantAppEntitlement|SalonPackConfig)/i.test(msg)) {
    return true;
  }
  if (/BOOTSTRAP_TENANT/i.test(msg)) return true;
  return false;
}

/** Server-log detail only — never serialize into public HTTP responses. */
export function describePlatformBootstrapFailure(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? 'unknown');
}

/** Safe public-facing message (no SQL / table / migration identifiers). */
export const PUBLIC_PLATFORM_BOOTSTRAP_MESSAGE =
  'Booking is temporarily unavailable while platform setup completes.';
