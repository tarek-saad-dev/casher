/**
 * DRVO-019 — public booking tenancy: two tenants against a mocked database (no real DB).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const TENANT_CUT = '11111111-1111-4111-8111-111111111111';
const TENANT_OTHER = '22222222-2222-4222-8222-222222222222';
const TENANT_NO_APP = '33333333-3333-4333-8333-333333333333';

type Q = { text: string; params: Record<string, unknown> };
const queries: Q[] = [];
let clientRowsByTenant: Record<string, Array<{ clientId: number }>> = {};

function respond(text: string, params: Record<string, unknown>): Array<Record<string, unknown>> {
  if (text.includes('QueueBookingSettings')) return [{ BookingEnabled: 1 }];
  if (text.includes('FROM [dbo].[TblClient]')) return clientRowsByTenant[String(params.tenantId)] ?? [];
  if (text.includes('FROM dbo.TblEmp WHERE EmpID')) {
    return Number(params.empId) === 501 && params.tenantId === TENANT_OTHER ? [{ ok: 1 }] : [];
  }
  if (text.includes('TenantBrandProfile')) {
    return [{ PublicBookingOrigins: JSON.stringify(['https://other-salon.example']) }];
  }
  return [];
}

vi.mock('@/lib/db', () => {
  const sql = new Proxy({}, { get: (_t, key) => Object.assign(() => String(key), { key }) });
  const getPool = async () => ({
    request() {
      const params: Record<string, unknown> = {};
      const req = {
        input(name: string, _type: unknown, value: unknown) {
          params[name] = value;
          return req;
        },
        async query(text: string) {
          queries.push({ text, params: { ...params } });
          return { recordset: respond(text, params) };
        },
      };
      return req;
    },
  });
  return { getPool, sql };
});

function branch(branchId: number, branchCode: string, extra: Record<string, unknown> = {}) {
  return {
    branchId,
    branchCode,
    branchName: `Branch ${branchCode}`,
    shortName: null,
    address: null,
    phone: null,
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00',
    defaultOpenTime: '10:00',
    defaultCloseTime: '23:00',
    isActive: true,
    lifecycleStatus: 'PUBLIC_LIVE',
    publicBookingEnabled: true,
    externalNotificationsEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: null,
    ...extra,
  };
}

const BRANCHES: Record<string, ReturnType<typeof branch>> = {
  CUTMAIN: branch(1, 'CUTMAIN'),
  OTHERA: branch(10, 'OTHERA'),
  NOAPP: branch(20, 'NOAPP'),
  CLOSED: branch(30, 'CLOSED', { isActive: false }),
};
const BRANCH_TENANT: Record<number, string> = { 1: TENANT_CUT, 10: TENANT_OTHER, 20: TENANT_NO_APP };
const TENANT_BRANCHES: Record<string, number[]> = {
  [TENANT_CUT]: [1],
  [TENANT_OTHER]: [10],
  [TENANT_NO_APP]: [20],
};

vi.mock('@/lib/branch/repository', () => ({
  getBranchByCode: vi.fn(async (code: string) => BRANCHES[code] ?? null),
  listActiveBranches: vi.fn(async () => Object.values(BRANCHES).filter((b) => b.isActive)),
}));

vi.mock('@/lib/branch/publicBranchVisibility', () => ({
  canBranchesAppearInPublicBooking: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, true]))),
}));

vi.mock('@/lib/booking/publicBookingTenant', () => ({
  resolvePublicTenantForBranchId: vi.fn(async (branchId: number) =>
    BRANCH_TENANT[branchId] ? { tenantId: BRANCH_TENANT[branchId] } : null,
  ),
  resolvePublicTenantForBookingCode: vi.fn(async (code: string) => {
    if (!/^[A-Z0-9]{4,}$/.test(code)) return { ok: false, reason: 'invalid_code' };
    if (code === 'CUTBOOK1') return { ok: true, tenant: { tenantId: TENANT_CUT } };
    if (code === 'NOAPPBK1') return { ok: true, tenant: { tenantId: TENANT_NO_APP } };
    return { ok: false, reason: 'not_found' };
  }),
}));

vi.mock('@/platform/commercial/tenantAccessGate', () => ({
  getTenantInstalledAppsForGate: vi.fn(async (tenantId: string) =>
    tenantId === TENANT_NO_APP ? ['pos'] : ['pos', 'booking'],
  ),
  evaluateTenantSubscriptionGate: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@/platform/branding/brandRepository', () => ({
  getTenantBrandProfileCached: vi.fn(async (tenantId: string) => ({
    tenantId,
    displayName: tenantId === TENANT_OTHER ? 'Other Salon' : 'Cut Saloon',
    logoUrl: null,
    primaryColor: '#123456',
    accentColor: 'not-a-color',
    publicBookingOrigins: tenantId === TENANT_OTHER ? ['https://other-salon.example'] : [],
  })),
}));

const seamCalls: string[] = [];
vi.mock('@/platform/tenant/legacyBootstrapSeam', () => ({
  resolveLegacyBootstrapTenantId: vi.fn(async (seam: string) => {
    seamCalls.push(seam);
    return TENANT_CUT;
  }),
}));

vi.mock('@/platform/tenant/tenantContext', () => ({
  isTenantContextError: () => false,
  listTenantLegacyBranchIds: vi.fn(async (tenantId: string) => new Set(TENANT_BRANCHES[tenantId] ?? [])),
}));

const CUT_ORIGIN = 'https://cutsaloon.com';

function req(origin?: string): Request {
  return new Request('https://app.example/api/public/booking/barbers', {
    headers: origin ? { origin } : {},
  });
}

let tenancy: typeof import('@/lib/booking/publicBookingTenancy');
let cors: typeof import('@/lib/booking/publicBookingCors');

beforeEach(async () => {
  vi.stubEnv('PUBLIC_BOOKING_ALLOWED_ORIGINS', CUT_ORIGIN);
  vi.stubEnv('NODE_ENV', 'production');
  tenancy = await import('@/lib/booking/publicBookingTenancy');
  cors = await import('@/lib/booking/publicBookingCors');
  tenancy.invalidatePublicBookingTenancyCache();
  cors.resetPublicBookingCorsCacheForTests();
  queries.length = 0;
  seamCalls.length = 0;
  clientRowsByTenant = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DRVO-019 tenant from the request', () => {
  it('resolves each tenant from its own branchCode', async () => {
    const a = await tenancy.resolvePublicBookingTenancy(req(), { branchCode: 'cutmain', route: 't' });
    const b = await tenancy.resolvePublicBookingTenancy(req(), { branchCode: 'OTHERA', route: 't' });
    expect(a).toEqual({ ok: true, tenancy: { tenantId: TENANT_CUT, source: 'branch', branchCode: 'CUTMAIN', branchId: 1 } });
    expect(b).toEqual({ ok: true, tenancy: { tenantId: TENANT_OTHER, source: 'branch', branchCode: 'OTHERA', branchId: 10 } });
    expect(seamCalls).toEqual([]);
  });

  it('unknown, inactive and malformed branch codes never fall back to a tenant', async () => {
    expect(await tenancy.resolvePublicBookingTenancy(req(), { branchCode: 'NOPE', route: 't', allowCutCompat: true })).toEqual({ ok: false, code: 'BRANCH_NOT_FOUND' });
    expect(await tenancy.resolvePublicBookingTenancy(req(), { branchCode: 'CLOSED', route: 't', allowCutCompat: true })).toEqual({ ok: false, code: 'BRANCH_NOT_FOUND' });
    expect(await tenancy.resolvePublicBookingTenancy(req(), { branchCode: '12345', route: 't' })).toEqual({ ok: false, code: 'INVALID_BRANCH_CODE' });
    expect(seamCalls).toEqual([]);
  });

  it('branchCode is required for routes without the CUT compatibility fallback', async () => {
    expect(await tenancy.resolvePublicBookingTenancy(req(), { branchCode: null, route: 't' })).toEqual({ ok: false, code: 'BRANCH_REQUIRED' });
    expect(seamCalls).toEqual([]);
  });

  it('CUT compatibility applies only without branchCode and for CUT legacy / no-Origin requests', async () => {
    const noOrigin = await tenancy.resolvePublicBookingTenancy(req(), { branchCode: null, route: 't', allowCutCompat: true });
    expect(noOrigin).toEqual({ ok: true, tenancy: { tenantId: TENANT_CUT, source: 'cut-compat', branchCode: null, branchId: null } });
    const cutOrigin = await tenancy.resolvePublicBookingTenancy(req(CUT_ORIGIN), { branchCode: '', route: 't', allowCutCompat: true });
    expect(cutOrigin.ok && cutOrigin.tenancy.source).toBe('cut-compat');
    expect(seamCalls.every((s) => s === 'public-booking-cut-compat')).toBe(true);

    const foreign = await tenancy.resolvePublicBookingTenancy(req('https://other-salon.example'), { branchCode: null, route: 't', allowCutCompat: true });
    expect(foreign).toEqual({ ok: false, code: 'BRANCH_REQUIRED' });
  });

  it('a tenant without the booking app answers like an unknown branch', async () => {
    expect(await tenancy.resolvePublicBookingTenancy(req(), { branchCode: 'NOAPP', route: 't' })).toEqual({ ok: false, code: 'BRANCH_NOT_FOUND' });
    expect(await tenancy.resolvePublicBookingTenancyForCode('NOAPPBK1', 't')).toEqual({ ok: false, reason: 'not_found' });
    expect(await tenancy.resolvePublicBookingTenancyForCode('CUTBOOK1', 't')).toEqual({ ok: true, tenantId: TENANT_CUT });
  });
});

describe('DRVO-019 branch context rejects cross-tenant branches', () => {
  it('BRANCH_NOT_FOUND when the branch belongs to another tenant', async () => {
    const { resolvePublicBookingBranchContext } = await import('@/lib/booking/publicBookingBranchContext');
    const own = await resolvePublicBookingBranchContext({ branchCode: 'OTHERA', purpose: 'public_booking', expectedTenantId: TENANT_OTHER });
    expect(own.tenantId).toBe(TENANT_OTHER);
    await expect(
      resolvePublicBookingBranchContext({ branchCode: 'OTHERA', purpose: 'public_booking', expectedTenantId: TENANT_CUT }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
    await expect(
      resolvePublicBookingBranchContext({ branchCode: 'NOAPP', purpose: 'public_booking' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
  });

  it('discoverable branches are filtered to the tenant', async () => {
    const cut = await tenancy.listPublicDiscoverableBranchesForTenant(TENANT_CUT);
    const other = await tenancy.listPublicDiscoverableBranchesForTenant(TENANT_OTHER);
    expect(cut.map((b) => b.branchCode)).toEqual(['CUTMAIN']);
    expect(other.map((b) => b.branchCode)).toEqual(['OTHERA']);
  });

  it('employees are checked against the tenant', async () => {
    expect(await tenancy.isPublicBookingTenantEmployee(TENANT_OTHER, 501)).toBe(true);
    expect(await tenancy.isPublicBookingTenantEmployee(TENANT_CUT, 501)).toBe(false);
    const q = queries.find((x) => x.text.includes('FROM dbo.TblEmp'));
    expect(q?.text).toMatch(/TenantId = @tenantId/);
  });
});

describe('DRVO-019 per-tenant CORS origins', () => {
  it('each tenant gets its own origins; CUT keeps the legacy env list; never *', async () => {
    const cutOrigins = await tenancy.loadPublicBookingTenantOrigins(TENANT_CUT);
    const otherOrigins = await tenancy.loadPublicBookingTenantOrigins(TENANT_OTHER);
    expect(cutOrigins).toEqual([CUT_ORIGIN]);
    expect(otherOrigins).toEqual(['https://other-salon.example']);
    expect([...cutOrigins, ...otherOrigins]).not.toContain('*');

    const allowed = cors.resolvePublicBookingCorsPolicy({ requestOrigin: 'https://other-salon.example', allowedOrigins: otherOrigins });
    const crossed = cors.resolvePublicBookingCorsPolicy({ requestOrigin: 'https://other-salon.example', allowedOrigins: cutOrigins });
    const cutOnOther = cors.resolvePublicBookingCorsPolicy({ requestOrigin: CUT_ORIGIN, allowedOrigins: otherOrigins });
    expect(allowed.kind).toBe('allowed');
    expect(crossed.kind).toBe('disallowed');
    expect(cutOnOther.kind).toBe('disallowed');
  });

  it('preflight union includes configured tenant origins', async () => {
    const all = await tenancy.loadAnyTenantPublicBookingOrigins();
    expect(all).toContain('https://other-salon.example');
  });
});

describe('DRVO-019 upcoming-by-phone is tenant-scoped', () => {
  it('a phone known only in another tenant lists nothing', async () => {
    clientRowsByTenant = { [TENANT_OTHER]: [{ clientId: 7 }] };
    const { listPublicUpcomingBookings } = await import('@/lib/booking/publicBookingReader');
    const res = await listPublicUpcomingBookings({ tenantId: TENANT_CUT, phone: '01012345678' });
    expect(res.bookings).toEqual([]);
    const lookup = queries.find((q) => q.text.includes('FROM [dbo].[TblClient]'));
    expect(lookup?.params.tenantId).toBe(TENANT_CUT);
    expect(queries.some((q) => q.text.includes('FROM dbo.Bookings b'))).toBe(false);
  });

  it('the bookings query carries TenantId predicates for client and branch', async () => {
    clientRowsByTenant = { [TENANT_OTHER]: [{ clientId: 7 }] };
    const { listPublicUpcomingBookings } = await import('@/lib/booking/publicBookingReader');
    await listPublicUpcomingBookings({ tenantId: TENANT_OTHER, phone: '01012345678' });
    const q = queries.find((x) => x.text.includes('FROM dbo.Bookings b'));
    expect(q).toBeTruthy();
    expect(q!.params.tenantId).toBe(TENANT_OTHER);
    expect(q!.text).toMatch(/c\.TenantId = @tenantId/);
    expect(q!.text).toMatch(/tl\.TenantId = @tenantId/);
  });
});

describe('DRVO-019 hosted page loader', () => {
  it('returns tenant branding for a public branch and null otherwise', async () => {
    const { loadHostedBookingPage } = await import('@/lib/booking/hostedBookingPage');
    const page = await loadHostedBookingPage('othera');
    expect(page).toMatchObject({
      branchCode: 'OTHERA',
      brand: { displayName: 'Other Salon', primaryColor: '#123456', accentColor: null },
    });
    expect(JSON.stringify(page)).not.toContain(TENANT_OTHER);
    expect(await loadHostedBookingPage('NOAPP')).toBeNull();
    expect(await loadHostedBookingPage('CLOSED')).toBeNull();
    expect(await loadHostedBookingPage('NOPE')).toBeNull();
    expect(await loadHostedBookingPage('%E0%A4%A')).toBeNull();
  });
});
