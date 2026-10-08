/**
 * DRVO-017 UI app gating: which installable app owns a navigation route.
 * Client-safe (no DB). The server-side gate stays requireTenantApp() on each API; this map only
 * hides nav entries and renders the "app not installed" state so the shell matches the tenant.
 * Routes not listed here are core (always available, subject to role permissions).
 */

export interface RouteAppRule {
  /** Pathname prefix, optionally with a `?tab=` query for HR tabs. */
  prefix: string;
  /** Route is available when ANY of these apps is installed. */
  anyOf: readonly string[];
}

export const ROUTE_APP_RULES: readonly RouteAppRule[] = [
  { prefix: '/income/pos', anyOf: ['pos'] },
  { prefix: '/income/new', anyOf: ['pos'] },
  { prefix: '/sales', anyOf: ['pos'] },
  { prefix: '/income-review', anyOf: ['pos'] },
  { prefix: '/queue', anyOf: ['queue'] },
  { prefix: '/bookings', anyOf: ['booking'] },
  { prefix: '/admin/booking', anyOf: ['booking'] },
  { prefix: '/admin/queue-booking-settings', anyOf: ['booking', 'queue'] },
  { prefix: '/treasury', anyOf: ['treasury'] },
  { prefix: '/cashier/treasury', anyOf: ['treasury'] },
  { prefix: '/manager/closing', anyOf: ['treasury'] },
  { prefix: '/admin/monthly-closing', anyOf: ['treasury'] },
  { prefix: '/admin/hr?tab=attendance', anyOf: ['attendance'] },
  { prefix: '/admin/hr?tab=daily-payroll', anyOf: ['payroll'] },
  { prefix: '/expenses-review/salaries', anyOf: ['payroll'] },
  { prefix: '/admin/loyalty', anyOf: ['loyalty'] },
  { prefix: '/admin/cut-club', anyOf: ['loyalty'] },
  { prefix: '/admin/whatsapp', anyOf: ['messaging'] },
  { prefix: '/admin/ai-concierge', anyOf: ['ai-receptionist'] },
  { prefix: '/reports', anyOf: ['reports'] },
  { prefix: '/admin/reports/full-day', anyOf: ['reports'] },
];

function matches(target: string, prefix: string): boolean {
  const [prefixPath, prefixQuery] = prefix.split('?');
  const [targetPath, targetQuery] = target.split('?');
  const path = targetPath.replace(/\/+$/, '') || '/';
  const pathOk = path === prefixPath || path.startsWith(`${prefixPath}/`);
  if (!pathOk) return false;
  if (!prefixQuery) return true;
  const want = new URLSearchParams(prefixQuery);
  const have = new URLSearchParams(targetQuery ?? '');
  for (const [k, v] of want) if (have.get(k) !== v) return false;
  return true;
}

/** Apps that can unlock `href` (pathname, optionally with query); null when the route is core. */
export function requiredAppsForRoute(href: string): readonly string[] | null {
  let best: RouteAppRule | null = null;
  for (const rule of ROUTE_APP_RULES) {
    if (matches(href, rule.prefix) && (!best || rule.prefix.length > best.prefix.length)) best = rule;
  }
  return best ? best.anyOf : null;
}

export function isRouteAvailable(href: string, installedApps: readonly string[]): boolean {
  const required = requiredAppsForRoute(href);
  if (!required) return true;
  return required.some((app) => installedApps.includes(app));
}
