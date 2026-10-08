/**
 * DRVO-013 — static guard: every staff API handler is tenant-checked.
 *
 * A handler is accepted when it (directly or through a local helper in its route file) calls an
 * approved auth helper. Approved helpers all resolve the authoritative tenant (membership ->
 * tenant -> active location + DRVO-012 subscription and route-family app gate), or are the
 * platform-operator / system-job / webhook gates. Anything else must be on the explicit
 * allowlist below, so a new bare or getSession-only handler fails this test.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {
  CRON_BEARER_PREFIX_ROUTES,
  PUBLIC_EXACT_ROUTES,
  PUBLIC_PREFIX_ROUTES,
} from '@/lib/proxyPublicRoutes';
import {
  ROUTE_APP_FAMILIES,
  ROUTE_APP_SYSTEM_JOB_ROUTES,
  resolveRouteAppCode,
} from '@/platform/commercial/routeAppFamilies';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(rel, out);
    } else if (entry.name === 'route.ts') {
      out.push(rel);
    }
  }
  return out;
}

const ROUTES = walk('src/app/api').sort();
/** `src/app/api/a/[id]/route.ts` -> `/api/a/[id]` */
const urlOf = (file: string) => file.replace(/^src\/app/, '').replace(/\/route\.ts$/, '');

/** Core helpers: resolve the authoritative tenant (src/lib/api-auth.ts, src/lib/branch/*). */
const CORE_TENANT_HELPERS = [
  'authenticate',
  'requireSession',
  'requireRole',
  'requireAdmin',
  'requirePageAccess',
  'requireTenantApp',
  'withTenantApp',
  'requireTenantSession',
  'authenticateTenantShell', // DRVO-017 read-only shell: authoritative tenant, subscription reported not enforced
  'requireLegacyGlobalDataSession',
  'requireWorkforceAvailabilityAccess',
  'requireTemporaryTransferAccess',
  'requireDevelopmentAdmin',
  'getActiveBranchContext',
  'requireActiveBranchContext',
  'requireBranchOperationAccess',
  'requireBranchReportAccess',
  'requireBranchAdminAccess',
  'requireBranchOperatorContext',
  'requireAuthenticatedBranchContext',
  'resolveBranchDayAndShiftForWrite',
];

/** Domain helpers that wrap a core helper (verified below). */
const INDIRECT_TENANT_HELPERS = [
  'requireWhatsAppTemplateAdmin',
  'resolveReportBranchScope',
  'resolveDailyPayrollViewScope',
  'resolveInternalOpsBookingRequest',
  'resolvePartnersReportBranchScope',
  'resolvePosPackageRequest',
];

/** Non-tenant gates with their own trust model. */
const SPECIAL_GATES = [
  'requirePlatformOperator', // control plane: super_admin + platform-owner membership, no tenant
  'requireSystemJobAuth', // cron bearer or admin session; tenant work fans out per tenant
  'requireWhatsAppInboxWebhookAuth', // WhatsApp gateway bearer (DRVO-018 owns messaging tenancy)
  'switchActiveBranch', // re-verifies session + membership; limited to the session tenant
];

const APPROVED = new Set([...CORE_TENANT_HELPERS, ...INDIRECT_TENANT_HELPERS, ...SPECIAL_GATES]);

/** Routes reachable anonymously by design (mirrors the proxy allowlist). */
function isPublicRoute(url: string): boolean {
  return (
    (PUBLIC_EXACT_ROUTES as readonly string[]).includes(url) ||
    (PUBLIC_PREFIX_ROUTES as readonly string[]).some((p) => url.startsWith(p))
  );
}

function calledNames(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) out.add(e.text);
      else if (ts.isPropertyAccessExpression(e)) out.add(e.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

type RouteInfo = { file: string; url: string; handlers: Map<string, Set<string>>; fns: Map<string, Set<string>> };

function analyze(file: string): RouteInfo {
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const fns = new Map<string, Set<string>>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) fns.set(st.name.text, calledNames(st));
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) fns.set(d.name.text, calledNames(d.initializer));
      }
    }
  }
  const handlers = new Map<string, Set<string>>();
  for (const m of METHODS) if (fns.has(m)) handlers.set(m, fns.get(m)!);
  return { file, url: urlOf(file), handlers, fns };
}

/** BFS from a handler through same-file helpers; returns the approved gates it reaches. */
function reachedGates(info: RouteInfo, method: string): Set<string> {
  const reached = new Set<string>();
  const seen = new Set([method]);
  const queue = [method];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const c of info.fns.get(cur) ?? []) {
      if (APPROVED.has(c)) reached.add(c);
      if (info.fns.has(c) && !seen.has(c)) {
        seen.add(c);
        queue.push(c);
      }
    }
  }
  return reached;
}

const INFOS = ROUTES.map(analyze);

describe('DRVO-013 zero unapproved bare staff route handlers', { timeout: 120_000 }, () => {
  it('finds the route tree', () => {
    expect(INFOS.length).toBeGreaterThan(400);
  });

  it('route files never re-export handlers (keeps this guard sound)', () => {
    for (const info of INFOS) {
      expect(read(info.file), info.file).not.toMatch(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b/);
      expect(read(info.file), info.file).not.toMatch(/export\s*\*\s*from/);
    }
  });

  it('every non-public handler reaches an approved tenant / platform / system gate', () => {
    const offenders: string[] = [];
    for (const info of INFOS) {
      if (isPublicRoute(info.url)) continue;
      for (const method of info.handlers.keys()) {
        if (reachedGates(info, method).size === 0) offenders.push(`${method} ${info.url}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('staff handlers never authorize from getSession() alone', () => {
    const offenders: string[] = [];
    for (const info of INFOS) {
      if (isPublicRoute(info.url)) continue;
      for (const method of info.handlers.keys()) {
        const reached = reachedGates(info, method);
        const calls = info.fns.get(method)!;
        if ((calls.has('getSession') || calls.has('getSessionPayload')) && reached.size === 0) {
          offenders.push(`${method} ${info.url}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every indirect helper wraps a core tenant helper', () => {
    const sources = [
      ...walkTs('src/app/api').filter((f) => !f.endsWith('/route.ts')),
      ...walkTs('src/lib'),
      ...walkTs('src/modules'),
      ...walkTs('src/apps'),
      ...walkTs('src/platform'),
    ];
    for (const helper of INDIRECT_TENANT_HELPERS) {
      const def = new RegExp(`(function\\s+${helper}\\b|const\\s+${helper}\\s*=)`);
      const file = sources.find((f) => def.test(read(f)));
      expect(file, `${helper} definition`).toBeTruthy();
      const body = read(file!);
      expect(
        CORE_TENANT_HELPERS.some((core) => new RegExp(`\\b${core}\\(`).test(body)),
        `${helper} (${file}) must call a core tenant helper`,
      ).toBe(true);
    }
  });

  it('control-plane maintenance routes (migrate-*, seed-*) are platform-operator only', () => {
    const tools = INFOS.filter((i) => /^\/api\/admin\/(migrate-|seed-)/.test(i.url));
    expect(tools.length).toBeGreaterThan(5);
    for (const info of tools) {
      for (const method of info.handlers.keys()) {
        const reached = reachedGates(info, method);
        expect(
          reached.has('requirePlatformOperator') || reached.has('requireDevelopmentAdmin'),
          `${method} ${info.url}`,
        ).toBe(true);
      }
    }
  });
});

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walkTs(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe('DRVO-013 app entitlement gates map route families to the right app', () => {
  const expectApp = (url: string, app: string | null) => expect(resolveRouteAppCode(url), url).toBe(app);

  it('product families resolve to their DRVO-012 app (longest prefix wins)', () => {
    expectApp('/api/bookings/12/convert', 'booking');
    expectApp('/api/admin/booking/v2/availability', 'booking');
    expectApp('/api/admin/booking-control/overrides', 'booking');
    expectApp('/api/operations/bookings/5/arrive', 'booking');
    expectApp('/api/queue/estimate', 'queue');
    expectApp('/api/operations/queue/create', 'queue');
    expectApp('/api/sales/recent', 'pos');
    expectApp('/api/pos/packages', 'pos');
    expectApp('/api/pos/client-inventory/use', 'loyalty');
    expectApp('/api/pos/client-inventory-by-phone', 'loyalty');
    expectApp('/api/pos/voucher', 'loyalty');
    expectApp('/api/admin/store/items', 'loyalty');
    expectApp('/api/loyalty/clients', 'loyalty');
    expectApp('/api/payroll/daily/generate', 'payroll');
    expectApp('/api/admin/hr/employee-ledger/payout', 'payroll');
    expectApp('/api/admin/attendance/bulk', 'attendance');
    expectApp('/api/inventory/branch', 'inventory');
    expectApp('/api/purchases', 'purchasing');
    expectApp('/api/reports/monthly', 'reports');
    expectApp('/api/admin/reports/partners', 'reports');
  });

  it('core / shared / treasury routes are not app-gated', () => {
    for (const url of [
      '/api/treasury/transfer',
      '/api/customers',
      '/api/services',
      '/api/employees',
      '/api/users',
      '/api/day/rollover-check',
      '/api/admin/branches',
      '/api/admin/hr/branch-transfer',
      '/api/bookingsx',
      '/api/pos-other',
    ]) {
      expectApp(url, null);
    }
  });

  it('every family prefix exists in the route tree', () => {
    for (const family of ROUTE_APP_FAMILIES) {
      expect(
        INFOS.some((i) => i.url === family.prefix || i.url.startsWith(`${family.prefix}/`)),
        family.prefix,
      ).toBe(true);
    }
  });

  it('the gate is evaluated at both authoritative tenant chokepoints', () => {
    expect(read('src/lib/api-auth.ts')).toMatch(/assertTenantSubscriptionActive\(tenant\.tenantId\);\s*await assertRouteAppEntitlement\(tenant\.tenantId\)/);
    expect(read('src/lib/branch/context.ts')).toMatch(/assertTenantSubscriptionActive\(tenantId\);\s*await assertRouteAppEntitlement\(tenantId\)/);
  });

  it('the proxy stamps x-pathname on every forwarded request (never client-supplied)', () => {
    const proxy = read('src/proxy.ts');
    const bareNext = proxy.match(/NextResponse\.next\(\)/g) ?? [];
    expect(bareNext.length, 'only static assets skip the stamp').toBe(1);
    expect(proxy).toContain("requestHeaders.set('x-pathname', pathname)");
  });

  it('every handler under an app family reaches a tenant-checked helper or is a fanned-out system job', () => {
    for (const info of INFOS) {
      if (!resolveRouteAppCode(info.url) || isPublicRoute(info.url)) continue;
      for (const method of info.handlers.keys()) {
        const reached = reachedGates(info, method);
        const tenantChecked = [...reached].some((g) => !SPECIAL_GATES.includes(g));
        const systemJob = ROUTE_APP_SYSTEM_JOB_ROUTES.includes(info.url) && reached.has('requireSystemJobAuth');
        const controlPlane = reached.has('requirePlatformOperator');
        expect(tenantChecked || systemJob || controlPlane, `${method} ${info.url}`).toBe(true);
      }
    }
  });
});

describe('DRVO-013 cron / system jobs fan out tenant-by-tenant', () => {
  /** Messaging internals stay CASHER_BOOT-only behind the legacy messaging seam (DRVO-018). */
  const MESSAGING_INTERNAL = /^\/api\/internal\/messaging\//;

  const systemJobRoutes = INFOS.filter((i) => /requireSystemJobAuth\(/.test(read(i.file)));

  it('every system-job route outside messaging runs through runTenantJobFanout with the caller scope', () => {
    const tenantJobs = systemJobRoutes.filter((i) => !MESSAGING_INTERNAL.test(i.url));
    expect(tenantJobs.map((i) => i.url).sort()).toEqual(
      [
        '/api/admin/attendance/auto-absence/run',
        '/api/admin/hr/nightly-close',
        '/api/internal/operations/business-day/reconcile',
        '/api/payroll/daily/auto-generate',
      ].sort(),
    );
    for (const info of tenantJobs) {
      const src = read(info.file);
      expect(src, info.file).toContain('runTenantJobFanout(');
      expect(src, info.file).toContain('tenantJobScopeFor(');
    }
  });

  it('app-family system jobs check the app per tenant', () => {
    expect(read('src/app/api/payroll/daily/auto-generate/route.ts')).toContain("app: 'payroll'");
    expect(read('src/app/api/admin/hr/nightly-close/route.ts')).toContain("app: 'payroll'");
    expect(read('src/app/api/admin/attendance/auto-absence/run/route.ts')).toContain("app: 'attendance'");
  });

  it('every cron-bearer proxy path is served by a handler that authenticates itself', () => {
    for (const prefix of CRON_BEARER_PREFIX_ROUTES) {
      const covered = INFOS.filter((i) => i.url === prefix.replace(/\/$/, '') || i.url.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
      for (const info of covered) {
        for (const method of info.handlers.keys()) {
          expect(reachedGates(info, method).size, `${method} ${info.url}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('job services take an explicit tenant branch scope instead of listing every branch', () => {
    for (const file of [
      'src/lib/hr/nightly-close.service.ts',
      'src/lib/hr/dailyPayrollBulkCloseRange.service.ts',
      'src/app/api/payroll/daily/auto-generate/route.ts',
    ]) {
      expect(read(file), file).not.toMatch(/\blistActiveBranches\(\)/);
      expect(read(file), file).toContain('listActiveBranchesIn(');
    }
    expect(read('src/modules/operations/application/reconcileBusinessDay.ts')).toMatch(
      /branchIds: readonly number\[\];/,
    );
  });
});
