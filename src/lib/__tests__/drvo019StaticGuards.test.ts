/**
 * DRVO-019 — static guards: public booking routes resolve their tenant from the request, booking
 * libraries scope master data by TenantId, CORS is per tenant and never `*`.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walkRoutes(rel, out);
    else if (entry.name === 'route.ts') out.push(rel);
  }
  return out;
}

const BOOKING_ROUTES = [...walkRoutes('src/app/api/public/booking'), 'src/app/api/public/branches/route.ts'].sort();

/** Routes with their own explicit tenant checks instead of the shared entry points. */
const OWN_TENANT_CHECK: Record<string, RegExp[]> = {
  // POST: branch context (tenant + app gate) + tenant employee; DELETE: hold-key tenant + app gate.
  'src/app/api/public/booking/hold/route.ts': [
    /isPublicBookingTenantEmployee\(ctx\.tenantId/,
    /resolvePublicTenantForHoldKey\(/,
    /isPublicBookingAvailableForTenant\(holdTenant\.tenantId\)/,
  ],
  // Development probe: tenant of the fixed probe branch, app-gated.
  'src/app/api/public/booking/v2/isolated-probe/route.ts': [/resolvePublicBookingTenantIdForBranch\(/],
};

const BOOKING_LIBS_WITH_TENANT_SQL = [
  'src/lib/booking/publicBookingServices.ts',
  'src/lib/booking/publicBookingBarbers.ts',
  'src/lib/booking/publicBookingReader.ts',
  'src/lib/booking/publicBookingCrossBranchAvailability.ts',
  'src/lib/booking/publicBarberMultiBranchAvailability.ts',
  'src/lib/booking/groomPackageBooking.ts',
];

describe('DRVO-019 public booking routes resolve the tenant from the request', () => {
  it('finds the public booking route tree', () => {
    expect(BOOKING_ROUTES.length).toBeGreaterThan(20);
  });

  it('every route uses a tenancy entry point (or its pinned explicit check)', () => {
    const offenders: string[] = [];
    for (const file of BOOKING_ROUTES) {
      const src = read(file);
      const own = OWN_TENANT_CHECK[file];
      if (own) {
        for (const re of own) if (!re.test(src)) offenders.push(`${file} missing ${re}`);
        continue;
      }
      if (!/requirePublicBookingRouteTenancy\(|requirePublicBookingCodeTenancy\(/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('routes with CORS preflight use the tenant-aware OPTIONS response', () => {
    for (const file of BOOKING_ROUTES) {
      const src = read(file);
      if (!/export async function OPTIONS/.test(src)) continue;
      expect(src, file).toContain('publicBookingTenantOptionsResponse(');
    }
  });

  it('routes never resolve the legacy bootstrap tenant directly', () => {
    for (const file of BOOKING_ROUTES) {
      expect(read(file), file).not.toMatch(/resolveLegacyBootstrapTenantId|CASHER_BOOT/);
    }
  });

  it('the CUT fallback is the named seam, only when branchCode is absent and the Origin is CUT legacy', () => {
    const src = read('src/lib/booking/publicBookingTenancy.ts');
    expect(src).toContain("resolveLegacyBootstrapTenantId('public-booking-cut-compat')");
    expect(src).toMatch(/if \(!args\.allowCutCompat \|\| !isCutCompatPublicBookingRequest\(req\)\)/);
    expect(src).not.toMatch(/process\.env\.[A-Z_]*TENANT/);
  });

  it('branch-scoped routes never opt into the CUT fallback', () => {
    for (const name of ['config', 'services', 'status', 'available-slots', 'available-days', 'check-slot', 'plan', 'create']) {
      const src = read(`src/app/api/public/booking/${name}/route.ts`);
      expect(src, name).not.toContain('allowCutCompat');
    }
  });

  it('create / check-slot / plan pass the resolved tenant down', () => {
    for (const name of ['create', 'check-slot', 'plan']) {
      expect(read(`src/app/api/public/booking/${name}/route.ts`), name).toContain('expectedTenantId');
    }
  });
});

describe('DRVO-019 booking libraries scope master data by TenantId', () => {
  it('libraries querying TblEmp / TblPro / TblClient carry a TenantId predicate', () => {
    for (const file of BOOKING_LIBS_WITH_TENANT_SQL) {
      const src = read(file);
      expect(src, file).toMatch(/TenantId = @tenantId/);
    }
  });

  it('upcoming-by-phone pre-gates through the tenant phone lookup', () => {
    const src = read('src/lib/booking/publicBookingReader.ts');
    expect(src).toContain('lookupClientIdByPhone(tenantId, normalizedPhone)');
    expect(src).toMatch(/c\.TenantId = @tenantId/);
  });

  it('branch context checks the expected tenant and keys its cache by tenant', () => {
    const src = read('src/lib/booking/publicBookingBranchContext.ts');
    expect(src).toMatch(/expectedTenantId/);
    expect(src).toMatch(/cacheKey\(tenantId,/);
  });
});

describe('DRVO-019 CORS', () => {
  it('never allows a wildcard origin in public booking code', () => {
    for (const file of [
      'src/lib/booking/publicBookingCors.ts',
      'src/lib/booking/publicBookingRouteGate.ts',
      'src/lib/booking/publicBookingTenancy.ts',
      ...BOOKING_ROUTES,
    ]) {
      expect(read(file), file).not.toMatch(/Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/);
    }
  });

  it('finalized responses use the bound tenant origins', () => {
    const src = read('src/lib/booking/publicBookingRouteGate.ts');
    expect(src.match(/allowedOrigins: gate\.tenantOrigins \?\? null/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('DRVO-019 hosted page', () => {
  it('awaits params and 404s through notFound()', () => {
    const src = read('src/app/book/[branchCode]/page.tsx');
    expect(src).toMatch(/await params/);
    expect(src).toContain("from 'next/navigation'");
    expect(src).toMatch(/if \(!data\) notFound\(\)/);
  });

  it('is Arabic / RTL and reachable anonymously', () => {
    expect(read('src/app/book/[branchCode]/HostedBookingFlow.tsx')).toContain('dir="rtl"');
    expect(read('src/lib/proxyPublicRoutes.ts')).toContain("'/book/'");
  });
});
