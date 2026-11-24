/**
 * Route registry — the single map of every page route in the app.
 *
 * Every `src/app/**\/page.tsx` must have exactly one entry here (enforced by
 * src/lib/__tests__/routeRegistry.test.ts). The registry answers:
 *   • which module a route belongs to (navigation / IA),
 *   • who may open it (`access`),
 *   • which permission path(s) from TblSystemPages unlock it (`permissions`),
 *   • whether it is a legacy redirect kept for old links/bookmarks.
 *
 * Permission paths use the same prefix rule as the menu (`canSeePage`):
 * a grant on `/bookings` also unlocks `/bookings/[id]`. The page catalogue
 * synced to the DB lives in src/lib/pages-registry.ts.
 */

export type RouteAccess =
  /** Anyone, no session needed (login, public booking, signup). */
  | 'public'
  /** Any signed-in user (landing redirects, 403, role landings). */
  | 'session'
  /** Requires a TblSystemPages grant (see `permissions`). */
  | 'page'
  /** DRVO platform operators only — enforced server-side by the platform layout. */
  | 'platform'
  /** Legacy URL that only redirects to its replacement. */
  | 'redirect';

export type RouteModule =
  | 'core'
  | 'pos'
  | 'sales'
  | 'expenses'
  | 'treasury'
  | 'bookings'
  | 'queue'
  | 'operations'
  | 'hr'
  | 'reports'
  | 'partners'
  | 'catalog'
  | 'loyalty'
  | 'messaging'
  | 'settings'
  | 'audit'
  | 'branches'
  | 'tenant'
  | 'platform'
  | 'public'
  | 'employee-portal';

export interface RouteEntry {
  /** Next.js route pattern, e.g. `/bookings/[id]`. */
  path: string;
  module: RouteModule;
  access: RouteAccess;
  /**
   * Permission paths (any one is enough). Defaults to `[path]` for `page`
   * routes; the prefix rule means child routes inherit their parent's grant.
   */
  permissions?: string[];
  /** For `redirect` routes: where the legacy URL goes. */
  redirectTo?: string;
}

export const ROUTES: RouteEntry[] = [
  // ── Core / session ──────────────────────────────────────────────────────────
  { path: '/', module: 'core', access: 'session' },
  { path: '/403', module: 'core', access: 'session' },
  { path: '/login', module: 'public', access: 'public' },
  { path: '/manager', module: 'operations', access: 'session' },
  { path: '/manager/closing', module: 'operations', access: 'session' },

  // ── Public / signup / employee portal ──────────────────────────────────────
  { path: '/book/[branchCode]', module: 'public', access: 'public' },
  { path: '/drvo', module: 'public', access: 'public' },
  { path: '/start', module: 'public', access: 'public' },
  { path: '/employee-portal', module: 'employee-portal', access: 'public' },
  { path: '/employee-portal/account-settings', module: 'employee-portal', access: 'public' },
  { path: '/employee-portal/bookings', module: 'employee-portal', access: 'public' },
  { path: '/employee-portal/change-password', module: 'employee-portal', access: 'public' },

  // ── POS & sales ────────────────────────────────────────────────────────────
  { path: '/income/pos', module: 'pos', access: 'page' },
  { path: '/income/new', module: 'sales', access: 'page' },
  { path: '/sales/today', module: 'sales', access: 'page' },
  { path: '/income-review/all-revenue', module: 'sales', access: 'page' },

  // ── Expenses & deductions ──────────────────────────────────────────────────
  { path: '/expenses', module: 'expenses', access: 'page' },
  { path: '/expenses/salaries', module: 'hr', access: 'page', permissions: ['/expenses-review/salaries'] },
  { path: '/deductions', module: 'expenses', access: 'page' },

  // ── Treasury & cash ────────────────────────────────────────────────────────
  {
    path: '/treasury/daily',
    module: 'treasury',
    access: 'page',
    // One screen for both roles: full controls with the treasury grant, the
    // cashier (close-shift only) view with the cashier grant.
    permissions: ['/treasury/daily', '/cashier/treasury/daily'],
  },
  { path: '/treasury/group-daily', module: 'treasury', access: 'page' },
  { path: '/treasury/period-summary', module: 'treasury', access: 'page' },
  { path: '/admin/monthly-closing', module: 'treasury', access: 'page' },
  { path: '/budget', module: 'treasury', access: 'page' },
  { path: '/budget/[id]', module: 'treasury', access: 'page' },

  // ── Bookings & queue ───────────────────────────────────────────────────────
  { path: '/bookings', module: 'bookings', access: 'page' },
  { path: '/bookings/[id]', module: 'bookings', access: 'page' },
  { path: '/bookings/new', module: 'bookings', access: 'page' },
  { path: '/bookings/calendar', module: 'bookings', access: 'page' },
  { path: '/queue/live', module: 'queue', access: 'page' },
  { path: '/queue/new', module: 'queue', access: 'page' },

  // ── Operations (day / shift / boards) ──────────────────────────────────────
  { path: '/operations', module: 'operations', access: 'page' },
  { path: '/admin/operations', module: 'operations', access: 'page' },
  { path: '/admin/day', module: 'operations', access: 'page' },
  { path: '/admin/shift', module: 'operations', access: 'page' },
  { path: '/admin/booking/operations', module: 'operations', access: 'page' },
  { path: '/admin/queue-booking-settings', module: 'settings', access: 'page' },

  // ── HR & workforce ─────────────────────────────────────────────────────────
  { path: '/admin/hr', module: 'hr', access: 'page' },
  { path: '/admin/hr/branch-transfer', module: 'hr', access: 'page' },
  { path: '/admin/hr/employees/[empId]/branch-schedule', module: 'hr', access: 'page', permissions: ['/admin/hr'] },
  { path: '/admin/workforce/availability', module: 'hr', access: 'page' },

  // ── Reports & partners ─────────────────────────────────────────────────────
  { path: '/reports/monthly', module: 'reports', access: 'page' },
  { path: '/reports/expenses/monthly', module: 'reports', access: 'page' },
  { path: '/reports/deductions/monthly', module: 'reports', access: 'page' },
  { path: '/admin/reports/full-day', module: 'reports', access: 'page' },
  { path: '/admin/reports/employee-services', module: 'reports', access: 'page' },
  { path: '/admin/reports/employee-monthly-work-revenue', module: 'reports', access: 'page' },
  { path: '/admin/reports/employee-monthly-work-revenue/print', module: 'reports', access: 'page' },
  { path: '/admin/reports/partners', module: 'partners', access: 'page' },
  { path: '/admin/reports/partners-real', module: 'partners', access: 'page' },
  { path: '/admin/reports/partners-overrides', module: 'partners', access: 'page' },
  { path: '/admin/partners', module: 'partners', access: 'page' },

  // ── Catalog & inventory ────────────────────────────────────────────────────
  { path: '/admin/services', module: 'catalog', access: 'page' },
  { path: '/admin/products', module: 'catalog', access: 'page' },
  { path: '/admin/inventory', module: 'catalog', access: 'page' },
  { path: '/admin/packages', module: 'catalog', access: 'page' },
  { path: '/admin/categories', module: 'catalog', access: 'page' },

  // ── Loyalty & customers ────────────────────────────────────────────────────
  { path: '/admin/loyalty', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/analytics', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/inventory', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/mystery-boxes', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/referrals', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/settings', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/store', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/tiers', module: 'loyalty', access: 'page' },
  { path: '/admin/cut-club/transactions', module: 'loyalty', access: 'page' },
  { path: '/admin/customers/follow-up', module: 'loyalty', access: 'page' },

  // ── Messaging (WhatsApp) & AI ──────────────────────────────────────────────
  { path: '/admin/whatsapp', module: 'messaging', access: 'page' },
  { path: '/admin/whatsapp/inbox', module: 'messaging', access: 'page' },
  { path: '/admin/integrations/whatsapp', module: 'messaging', access: 'page' },
  { path: '/admin/integrations/drvowa', module: 'messaging', access: 'page', permissions: ['/admin/integrations/whatsapp', '/admin/whatsapp'] },
  { path: '/admin/ai-concierge', module: 'messaging', access: 'page' },

  // ── Settings, users & permissions ──────────────────────────────────────────
  { path: '/admin/settings', module: 'settings', access: 'page' },
  { path: '/admin/settings/printing', module: 'settings', access: 'page' },
  { path: '/admin/users', module: 'settings', access: 'page' },
  { path: '/admin/permissions/users', module: 'settings', access: 'page' },
  { path: '/admin/permissions/pages', module: 'settings', access: 'page' },
  { path: '/admin/approvals', module: 'audit', access: 'page' },

  // ── Audit & accounting ─────────────────────────────────────────────────────
  { path: '/admin/audit/cash-move-classification', module: 'audit', access: 'page' },
  { path: '/admin/accounting/classification-lab', module: 'audit', access: 'page' },
  { path: '/admin/accounting/classification-settings', module: 'audit', access: 'page' },

  // ── Branches & tenant ──────────────────────────────────────────────────────
  { path: '/admin/branches', module: 'branches', access: 'page' },
  { path: '/admin/branches/new', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/activate', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/readiness', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/setup', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/setup/employees', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/setup/opening-cash', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/setup/opening-inventory', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/setup/partners', module: 'branches', access: 'page' },
  { path: '/admin/branches/[id]/setup/payroll-targets', module: 'branches', access: 'page' },
  { path: '/admin/tenant', module: 'tenant', access: 'page' },
  { path: '/admin/apps', module: 'tenant', access: 'page', permissions: ['/admin/tenant'] },
  { path: '/admin/billing', module: 'tenant', access: 'page', permissions: ['/admin/tenant'] },

  // ── DRVO platform console ──────────────────────────────────────────────────
  { path: '/platform', module: 'platform', access: 'platform' },
  { path: '/platform/billing-requests', module: 'platform', access: 'platform' },
  { path: '/platform/modular-pricing', module: 'platform', access: 'platform' },
  { path: '/platform/modular-quote-inquiries', module: 'platform', access: 'platform' },
  { path: '/platform/pricing', module: 'platform', access: 'platform' },
  { path: '/platform/tariff-research', module: 'platform', access: 'platform' },
  { path: '/platform/tenants/[tenantId]', module: 'platform', access: 'platform' },
  { path: '/platform/tenants/new', module: 'platform', access: 'platform' },
];

function normalize(pathname: string): string {
  return pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
}

function toMatcher(pattern: string): RegExp {
  const body = pattern
    .split('/')
    .map((seg) =>
      /^\[\.\.\.[^\]]+\]$/.test(seg)
        ? '.+'
        : /^\[[^\]]+\]$/.test(seg)
          ? '[^/]+'
          : seg.replace(/[.*+?^${}()|\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${body}$`);
}

const COMPILED = ROUTES.map((entry) => ({
  entry,
  re: toMatcher(entry.path),
  // Static segments win over dynamic ones when both match.
  specificity: entry.path.split('/').filter((s) => s && !s.startsWith('[')).length,
}));

/** Resolve a concrete pathname (e.g. `/bookings/42`) to its registry entry. */
export function matchRoute(pathname: string): RouteEntry | null {
  const clean = normalize(pathname);
  let best: (typeof COMPILED)[number] | null = null;
  for (const c of COMPILED) {
    if (c.re.test(clean) && (!best || c.specificity > best.specificity)) best = c;
  }
  return best?.entry ?? null;
}

/** Permission paths that unlock a route (any one is enough). */
export function requiredPermissions(entry: RouteEntry): string[] {
  return entry.permissions && entry.permissions.length > 0 ? entry.permissions : [entry.path];
}

export interface RouteAccessSubject {
  isSuperAdmin: boolean;
  isPartnerOnly: boolean;
  allowedPagePaths: string[];
}

/**
 * Does one granted page path cover `target`?
 *  • plain grant (`/bookings`)            → the path and every sub-path
 *  • tab grant (`/admin/hr?tab=attendance`) → exactly that path AND those
 *    query params (e.g. a manager allowed only the attendance tab).
 */
function pathAllows(allowed: string, target: string, targetSearch: string): boolean {
  const [allowedPathRaw, allowedQuery = ''] = allowed.split('?');
  const a = normalize(allowedPathRaw);
  const t = normalize(target);
  if (!allowedQuery) return t === a || t.startsWith(`${a}/`);
  if (t !== a) return false;
  const required = new URLSearchParams(allowedQuery);
  const actual = new URLSearchParams(target.includes('?') ? target.split('?')[1] : targetSearch);
  for (const [key, value] of required) {
    if (actual.get(key) !== value) return false;
  }
  return true;
}

/**
 * True when the subject holds a grant covering `permissionPath` (menu prefix
 * rule). `search` is the current query string, used for tab-level grants.
 */
export function hasPagePermission(subject: RouteAccessSubject, permissionPath: string, search = ''): boolean {
  if (subject.isSuperAdmin) return true;
  return subject.allowedPagePaths.some((allowed) => pathAllows(allowed, permissionPath, search));
}

export type RouteAccessDecision =
  | {
      allowed: true;
      reason: 'public' | 'session' | 'platform' | 'redirect' | 'super_admin' | 'granted' | 'unregistered';
    }
  | { allowed: false; reason: 'missing_permission' | 'partner_scope'; required: string[] };

/**
 * Decide whether `subject` may open `pathname`.
 * Unregistered paths are allowed here (the registry test guarantees there are none).
 * This is a UX/defence-in-depth gate: APIs keep their own server-side checks.
 */
export function decideRouteAccess(pathname: string, subject: RouteAccessSubject, search = ''): RouteAccessDecision {
  const query = pathname.includes('?') ? pathname.split('?')[1] : search.replace(/^\?/, '');
  const entry = matchRoute(pathname);
  if (!entry) return { allowed: true, reason: 'unregistered' };
  if (entry.access === 'public') return { allowed: true, reason: 'public' };
  if (entry.access === 'redirect') return { allowed: true, reason: 'redirect' };
  if (entry.access === 'platform') return { allowed: true, reason: 'platform' };
  if (subject.isSuperAdmin) return { allowed: true, reason: 'super_admin' };
  const required = requiredPermissions(entry);
  if (subject.isPartnerOnly) {
    return required.includes('/admin/reports/partners')
      ? { allowed: true, reason: 'granted' }
      : { allowed: false, reason: 'partner_scope', required };
  }
  if (entry.access === 'session') return { allowed: true, reason: 'session' };
  const ok = required.some((req) => hasPagePermission(subject, req, query));
  return ok ? { allowed: true, reason: 'granted' } : { allowed: false, reason: 'missing_permission', required };
}
