/**
 * Pure proxy public-route matcher — testable without Next.js request objects.
 * Defense-in-depth only; route handlers remain authoritative.
 */

/** Exact path matches (no prefix). */
export const PUBLIC_EXACT_ROUTES = [
  '/login',
  '/api/auth/login',
] as const;

/**
 * Prefix matches. Intentionally excludes `/api/admin/` and generic `/api/`.
 * Public booking lives under `/api/public/`.
 */
export const PUBLIC_PREFIX_ROUTES = [
  '/api/public/',
] as const;

/**
 * Machine/cron endpoints: allowed through the edge without a session cookie
 * only when Bearer authentication succeeds (see isCronBearerAuthorized).
 */
export const CRON_BEARER_PREFIX_ROUTES = [
  '/api/cron/',
  '/api/admin/hr/nightly-close',
  '/api/payroll/daily/auto-generate',
] as const;

export function isStaticOrNextAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  );
}

export function isPublicExactRoute(pathname: string): boolean {
  return (PUBLIC_EXACT_ROUTES as readonly string[]).includes(pathname);
}

export function isPublicPrefixRoute(pathname: string): boolean {
  return (PUBLIC_PREFIX_ROUTES as readonly string[]).some((p) =>
    pathname.startsWith(p),
  );
}

/** True when path is allowlisted as anonymous (not cron-gated). */
export function isAnonymousPublicPath(pathname: string): boolean {
  return isPublicExactRoute(pathname) || isPublicPrefixRoute(pathname);
}

/** True when path may skip session cookie if Bearer cron auth succeeds. */
export function isCronBearerPath(pathname: string): boolean {
  return (CRON_BEARER_PREFIX_ROUTES as readonly string[]).some((p) =>
    pathname.startsWith(p),
  );
}

/**
 * Classify whether the proxy should let the request through without a session.
 * Cron paths require Bearer when there is no session cookie (checked by caller).
 */
export function classifyProxyAuth(pathname: string): {
  kind: 'static' | 'anonymous_public' | 'cron_bearer' | 'session_required';
} {
  if (isStaticOrNextAsset(pathname)) return { kind: 'static' };
  if (isAnonymousPublicPath(pathname)) return { kind: 'anonymous_public' };
  if (isCronBearerPath(pathname)) return { kind: 'cron_bearer' };
  return { kind: 'session_required' };
}

/** Reject accidental broad admin exposure. */
export function isAdminApiPath(pathname: string): boolean {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export function extractBearerToken(authorizationHeader: string | null): string {
  const authHeader = authorizationHeader ?? '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return authHeader;
}

/**
 * Cron bearer check. Production requires CRON_SECRET to be set.
 * Development may accept literal "dev" only when CRON_SECRET is unset.
 */
export function isCronBearerAuthorized(
  authorizationHeader: string | null,
  env: { CRON_SECRET?: string; NODE_ENV?: string } = process.env,
): boolean {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return false;
  const secret = env.CRON_SECRET;
  if (secret) return token === secret;
  if (env.NODE_ENV === 'production') return false;
  return token === 'dev';
}
