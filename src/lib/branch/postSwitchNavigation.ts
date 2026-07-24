/**
 * Pure navigation helper (safe for unit tests without 'use client').
 * Avoid previous-branch entity URLs after a session branch switch.
 */
export function resolvePostSwitchNavigationPath(pathname: string | null | undefined): string {
  const path = (pathname ?? '/').split('?')[0] || '/';
  if (path === '/' || path === '') return '/';

  const unsafePatterns = [
    /^\/operations\/bookings\/\d+/i,
    /^\/bookings\/\d+/i,
    /^\/sales\/\d+/i,
    /^\/queue\/\d+/i,
    /^\/income\/\d+/i,
    /^\/expenses\/\d+/i,
    /^\/incomes\/\d+/i,
  ];
  if (unsafePatterns.some((re) => re.test(path))) {
    return '/';
  }

  return path.startsWith('/') ? path : '/';
}
