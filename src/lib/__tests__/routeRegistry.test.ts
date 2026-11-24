import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROUTES,
  decideRouteAccess,
  matchRoute,
  requiredPermissions,
  type RouteAccessSubject,
} from '@/lib/routing/routeRegistry';
import { NAV_SECTIONS, NAV_DIRECT_LINKS, getActiveNavItem } from '@/components/layout/nav-config';
import { SYSTEM_PAGES } from '@/lib/pages-registry';
import { LEGACY_REDIRECTS } from '@/lib/routing/legacyRedirects';

const root = process.cwd();
const appDir = path.join(root, 'src', 'app');

function pageRoutes(): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'api' || entry.name === '__tests__') continue;
        walk(full);
      } else if (entry.name === 'page.tsx') {
        const segments = path
          .relative(appDir, path.dirname(full))
          .split(path.sep)
          .filter((s) => s && !/^\(.*\)$/.test(s));
        out.push({ route: `/${segments.join('/')}`.replace(/\/$/, '') || '/', file: full });
      }
    }
  };
  walk(appDir);
  return out;
}

/** Paths granted by DB migrations rather than src/lib/pages-registry.ts. */
const MIGRATION_GRANTED = ['/admin/tenant', '/admin/workforce/availability'];

function grantable(permission: string): boolean {
  const target = permission.split('?')[0];
  const catalogue = [...SYSTEM_PAGES.map((p) => p.path.split('?')[0]), ...MIGRATION_GRANTED];
  return catalogue.some((p) => target === p || target.startsWith(`${p}/`));
}

const subject = (allowedPagePaths: string[], extra: Partial<RouteAccessSubject> = {}): RouteAccessSubject => ({
  isSuperAdmin: false,
  isPartnerOnly: false,
  allowedPagePaths,
  ...extra,
});

describe('route registry ↔ app directory', () => {
  const pages = pageRoutes();

  it('every page.tsx has exactly one registry entry', () => {
    const registered = new Set(ROUTES.map((r) => r.path));
    const missing = pages.map((p) => p.route).filter((r) => !registered.has(r));
    expect(missing).toEqual([]);
    const dupes = ROUTES.map((r) => r.path).filter((p, i, all) => all.indexOf(p) !== i);
    expect(dupes).toEqual([]);
  });

  it('every registry entry points at a real page.tsx', () => {
    const existing = new Set(pages.map((p) => p.route));
    expect(ROUTES.map((r) => r.path).filter((p) => !existing.has(p))).toEqual([]);
  });

  it('there is only one page for "/" (no duplicate route-group root)', () => {
    expect(pages.filter((p) => p.route === '/')).toHaveLength(1);
  });

  it('redirect entries really redirect to an existing, non-redirect route', () => {
    for (const entry of ROUTES.filter((r) => r.access === 'redirect')) {
      expect(entry.redirectTo, entry.path).toBeTruthy();
      const file = pages.find((p) => p.route === entry.path)!.file;
      const src = fs.readFileSync(file, 'utf8');
      expect(src, entry.path).toMatch(/redirect\(/);
      const target = matchRoute(entry.redirectTo!);
      expect(target, `${entry.path} → ${entry.redirectTo}`).not.toBeNull();
      expect(target!.access, entry.redirectTo).not.toBe('redirect');
    }
  });

  it('legacy URLs (next.config redirects) have no page and land on a live route', () => {
    const existing = new Set(pages.map((p) => p.route));
    const sources = LEGACY_REDIRECTS.map((r) => r.source);
    expect(sources.filter((s, i) => sources.indexOf(s) !== i)).toEqual([]);
    for (const r of LEGACY_REDIRECTS) {
      expect(existing.has(r.source), `${r.source} still has a page.tsx`).toBe(false);
      expect(matchRoute(r.source)?.path === r.source, `${r.source} still in ROUTES`).toBe(false);
      const target = matchRoute(r.destination.split('?')[0]);
      expect(target, `${r.source} → ${r.destination}`).not.toBeNull();
      expect(target!.access, r.destination).not.toBe('redirect');
    }
  });

  it('next.config.ts serves the legacy redirects', () => {
    const cfg = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
    expect(cfg).toContain('LEGACY_REDIRECTS');
    expect(cfg).toMatch(/async redirects\(\)/);
  });

  it('every page route needs a grant that can actually be given', () => {
    const ungrantable = ROUTES.filter((r) => r.access === 'page')
      .filter((r) => !requiredPermissions(r).some(grantable))
      .map((r) => r.path);
    expect(ungrantable).toEqual([]);
  });
});

describe('navigation ↔ route registry', () => {
  const hrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

  it('every menu link resolves to a live (non-redirect) route', () => {
    for (const href of [...hrefs, ...NAV_DIRECT_LINKS.map((l) => l.href)]) {
      const entry = matchRoute(href);
      expect(entry, href).not.toBeNull();
      expect(entry!.access, href).not.toBe('redirect');
    }
  });

  it('no link appears twice in the menu', () => {
    expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i)).toEqual([]);
  });

  it('tab links win over their parent page for the active state', () => {
    expect(getActiveNavItem('/admin/hr', 'tab=attendance')?.href).toBe('/admin/hr?tab=attendance');
    expect(getActiveNavItem('/admin/hr', '')?.href).toBe('/admin/hr');
    expect(getActiveNavItem('/bookings/42', '')?.href).toBe('/bookings');
  });
});

describe('decideRouteAccess', () => {
  it('lets public, platform and redirect routes through', () => {
    const nobody = subject([]);
    expect(decideRouteAccess('/login', nobody).allowed).toBe(true);
    expect(decideRouteAccess('/book/abc', nobody).allowed).toBe(true);
    expect(decideRouteAccess('/platform/tenants/x', nobody).allowed).toBe(true);
    expect(decideRouteAccess('/expenses/new', nobody).allowed).toBe(true);
  });

  it('requires a grant for page routes and inherits parent grants', () => {
    expect(decideRouteAccess('/admin/users', subject([])).allowed).toBe(false);
    expect(decideRouteAccess('/admin/users', subject(['/admin/users'])).allowed).toBe(true);
    expect(decideRouteAccess('/bookings/17', subject(['/bookings'])).allowed).toBe(true);
    expect(decideRouteAccess('/bookingsx', subject(['/bookings'])).allowed).toBe(true); // unregistered
  });

  it('honours tab-level grants without opening the whole page', () => {
    const manager = subject(['/admin/hr?tab=attendance']);
    expect(decideRouteAccess('/admin/hr', manager, 'tab=attendance').allowed).toBe(true);
    expect(decideRouteAccess('/admin/hr?tab=attendance', manager).allowed).toBe(true);
    expect(decideRouteAccess('/admin/hr', manager, 'tab=daily-payroll').allowed).toBe(false);
    expect(decideRouteAccess('/admin/hr', manager).allowed).toBe(false);
  });

  it('opens the merged treasury page with either the treasury or the cashier grant', () => {
    expect(decideRouteAccess('/treasury/daily', subject(['/cashier/treasury/daily'])).allowed).toBe(true);
    expect(decideRouteAccess('/treasury/daily', subject(['/treasury/daily'])).allowed).toBe(true);
    expect(decideRouteAccess('/treasury/daily', subject(['/treasury/movement'])).allowed).toBe(false);
  });

  it('keeps partner-only users on the partners report', () => {
    const partner = subject([], { isPartnerOnly: true });
    expect(decideRouteAccess('/admin/reports/partners', partner).allowed).toBe(true);
    expect(decideRouteAccess('/income/pos', partner)).toMatchObject({ allowed: false, reason: 'partner_scope' });
  });

  it('super admins open every page route', () => {
    const root = subject([], { isSuperAdmin: true });
    for (const entry of ROUTES) {
      const concrete = entry.path.replace(/\[[^\]]+\]/g, '1');
      expect(decideRouteAccess(concrete, root).allowed, entry.path).toBe(true);
    }
  });
});
