import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  classifyProxyAuth,
  isAdminApiPath,
  isAnonymousPublicPath,
  isCronBearerAuthorized,
  isCronBearerPath,
} from '@/lib/proxyPublicRoutes';

describe('proxy public allowlist (Phase 1A)', () => {
  it('keeps login and public booking anonymous', () => {
    expect(isAnonymousPublicPath('/login')).toBe(true);
    expect(isAnonymousPublicPath('/api/auth/login')).toBe(true);
    expect(isAnonymousPublicPath('/api/auth/session')).toBe(true);
    expect(isAnonymousPublicPath('/api/permissions/my-access')).toBe(true);
    expect(isAnonymousPublicPath('/api/public/booking/available-slots')).toBe(true);
    expect(isAnonymousPublicPath('/api/public/booking/create')).toBe(true);
  });

  it('lets auth/session and my-access reach handlers without a cookie', () => {
    expect(classifyProxyAuth('/api/auth/session').kind).toBe('anonymous_public');
    expect(classifyProxyAuth('/api/permissions/my-access').kind).toBe('anonymous_public');
  });

  it('does not expose /api/admin/* as anonymous public', () => {
    expect(isAnonymousPublicPath('/api/admin/store/clear')).toBe(false);
    expect(isAnonymousPublicPath('/api/admin/hr/nightly-close')).toBe(false);
    expect(isAdminApiPath('/api/admin/store/clear')).toBe(true);
    expect(classifyProxyAuth('/api/admin/store/clear').kind).toBe('session_required');
  });

  it('does not expose flow-board anonymously', () => {
    expect(isAnonymousPublicPath('/api/operations/flow-board')).toBe(false);
    expect(classifyProxyAuth('/api/operations/flow-board').kind).toBe('session_required');
  });

  it('classifies scheduled jobs as cron_bearer (not anonymous)', () => {
    expect(isCronBearerPath('/api/admin/hr/nightly-close')).toBe(true);
    expect(isCronBearerPath('/api/payroll/daily/auto-generate')).toBe(true);
    expect(classifyProxyAuth('/api/payroll/daily/auto-generate').kind).toBe('cron_bearer');
  });

  it('rejects missing cron bearer in production when secret unset', () => {
    expect(
      isCronBearerAuthorized(null, { NODE_ENV: 'production', CRON_SECRET: undefined }),
    ).toBe(false);
    expect(
      isCronBearerAuthorized('Bearer dev', { NODE_ENV: 'production', CRON_SECRET: undefined }),
    ).toBe(false);
  });

  it('accepts matching CRON_SECRET bearer', () => {
    expect(
      isCronBearerAuthorized('Bearer s3cret', {
        NODE_ENV: 'production',
        CRON_SECRET: 's3cret',
      }),
    ).toBe(true);
    expect(
      isCronBearerAuthorized('Bearer wrong', {
        NODE_ENV: 'production',
        CRON_SECRET: 's3cret',
      }),
    ).toBe(false);
  });

  it('allows Bearer "dev" only when secret unset outside production', () => {
    expect(
      isCronBearerAuthorized('Bearer dev', { NODE_ENV: 'development', CRON_SECRET: undefined }),
    ).toBe(true);
  });
});

describe('requireDevelopmentAdmin / db toggle auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockBranchAwareSession(user: {
    UserID: number;
    UserName: string;
    UserLevel: string;
  }) {
    vi.doMock('@/lib/session', () => ({
      getSession: vi.fn(async () => ({
        ...user,
        ActiveBranchID: 1,
        ActiveBranchCode: 'GLEEM',
        BranchSessionVersion: 1,
      })),
      destroySession: vi.fn(async () => undefined),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: false,
        userName: user.UserName,
        userLevel: user.UserLevel,
      })),
    }));
  }

  it('returns 404 in production', async () => {
    mockBranchAwareSession({ UserID: 1, UserName: 'Admin', UserLevel: 'admin' });
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(async () => ({
        roles: ['admin'],
        isSuperAdmin: true,
        pages: [],
      })),
      canAccessPath: vi.fn(async () => true),
    }));

    const { requireDevelopmentAdmin, isAuthResult } = await import('@/lib/api-auth');
    const result = await requireDevelopmentAdmin({ NODE_ENV: 'production' });
    expect(isAuthResult(result)).toBe(false);
    expect((result as NextResponse).status).toBe(404);
  });

  it('requires admin in development', async () => {
    mockBranchAwareSession({ UserID: 2, UserName: 'Cashier', UserLevel: 'user' });
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(async () => ({
        roles: ['cashier'],
        isSuperAdmin: false,
        pages: [],
      })),
      canAccessPath: vi.fn(async () => false),
    }));

    const { requireDevelopmentAdmin, isAuthResult } = await import('@/lib/api-auth');
    const result = await requireDevelopmentAdmin({ NODE_ENV: 'development' });
    expect(isAuthResult(result)).toBe(false);
    expect((result as NextResponse).status).toBe(403);
  });

  it('allows admin in development', async () => {
    mockBranchAwareSession({ UserID: 1, UserName: 'Admin', UserLevel: 'admin' });
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(async () => ({
        roles: ['admin'],
        isSuperAdmin: false,
        pages: [],
      })),
      canAccessPath: vi.fn(async () => true),
    }));

    const { requireDevelopmentAdmin, isAuthResult } = await import('@/lib/api-auth');
    const result = await requireDevelopmentAdmin({ NODE_ENV: 'development' });
    expect(isAuthResult(result)).toBe(true);
  });
});

describe('flow-board route auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects anonymous requests', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      isAuthResult: (v: { ok?: boolean }) => v?.ok === true,
      requirePageAccess: vi.fn(async () =>
        NextResponse.json({ error: 'غير مصرح' }, { status: 401 }),
      ),
    }));
    vi.doMock('@/lib/db', () => ({ getPool: vi.fn(), sql: {} }));
    vi.doMock('@/lib/businessDate', () => ({ getCairoBusinessDate: () => '2026-07-15' }));
    vi.doMock('@/lib/queueLifecycleEngine', () => ({ computeEffectiveTicket: vi.fn() }));
    vi.doMock('@/lib/bookingDateTime', () => ({
      normalizeBookingTimes: vi.fn(),
      sqlTimeToHhmm: vi.fn(),
      createCairoDateTime: vi.fn(),
      sqlDateToYyyyMmDd: vi.fn(),
    }));
    vi.doMock('@/lib/availabilityEngine', () => ({ getBarbersDayStatus: vi.fn() }));
    vi.doMock('@/lib/devRequestTiming', () => ({
      createDevTimer: () => ({
        mark: () => undefined,
        end: () => undefined,
        setAbsolute: () => undefined,
        log: () => undefined,
      }),
    }));

    const { GET } = await import('@/app/api/operations/flow-board/route');
    const res = await GET(new NextRequest('http://localhost/api/operations/flow-board'));
    expect(res.status).toBe(401);
  });

  it('allows authorized operations users (auth passes through to handler)', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      isAuthResult: (v: { ok?: boolean }) => v?.ok === true,
      requirePageAccess: vi.fn(async () => ({
        ok: true,
        userId: 1,
        userName: 'Ops',
        userLevel: 'admin',
        roles: ['admin'],
        isSuperAdmin: false,
      })),
    }));

    const query = vi.fn(async () => ({ recordset: [] }));
    const request = vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query,
    }));
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({ request })),
      sql: { Date: () => ({}), NVarChar: () => ({}), Int: () => ({}) },
    }));
    vi.doMock('@/lib/businessDate', () => ({ getCairoBusinessDate: () => '2026-07-15' }));
    vi.doMock('@/lib/queueLifecycleEngine', () => ({ computeEffectiveTicket: vi.fn() }));
    vi.doMock('@/lib/bookingDateTime', () => ({
      normalizeBookingTimes: vi.fn(),
      sqlTimeToHhmm: vi.fn(),
      createCairoDateTime: vi.fn(),
      sqlDateToYyyyMmDd: vi.fn((d: string) => d),
    }));
    vi.doMock('@/lib/availabilityEngine', () => ({
      getBarbersDayStatus: vi.fn(async () => new Map()),
    }));
    vi.doMock('@/lib/devRequestTiming', () => ({
      createDevTimer: () => ({
        mark: () => undefined,
        end: () => undefined,
        setAbsolute: () => undefined,
        log: () => undefined,
      }),
    }));

    const { GET } = await import('@/app/api/operations/flow-board/route');
    const res = await GET(
      new NextRequest('http://localhost/api/operations/flow-board?date=2026-07-15'),
    );
    // Auth passed; handler may return 200 with empty barbers or continue.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe('requireSystemJobAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/api-auth');
    vi.doUnmock('@/lib/session');
    vi.doUnmock('@/lib/permissions-server');
  });

  it('rejects missing machine authentication', async () => {
    vi.doMock('@/lib/session', () => ({
      getSession: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(),
      canAccessPath: vi.fn(),
    }));

    const { requireSystemJobAuth, isSystemJobAuthResult } = await import('@/lib/api-auth');
    const req = new NextRequest('http://localhost/api/payroll/daily/auto-generate', {
      method: 'POST',
    });
    const result = await requireSystemJobAuth(req, {
      NODE_ENV: 'production',
      CRON_SECRET: 'real-secret',
    });
    expect(isSystemJobAuthResult(result)).toBe(false);
    expect((result as NextResponse).status).toBe(401);
  });

  it('accepts valid bearer secret', async () => {
    vi.doMock('@/lib/session', () => ({
      getSession: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(),
      canAccessPath: vi.fn(),
    }));

    const { requireSystemJobAuth, isSystemJobAuthResult } = await import('@/lib/api-auth');
    const req = new NextRequest('http://localhost/api/admin/hr/nightly-close', {
      method: 'POST',
      headers: { authorization: 'Bearer real-secret' },
    });
    const result = await requireSystemJobAuth(req, {
      NODE_ENV: 'production',
      CRON_SECRET: 'real-secret',
    });
    expect(isSystemJobAuthResult(result)).toBe(true);
    if (isSystemJobAuthResult(result)) {
      expect(result.via).toBe('cron_bearer');
    }
  });
});

describe('admin store mutation auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('anonymous clear returns 401/403', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      isAuthResult: (v: { ok?: boolean }) => v?.ok === true,
      requirePageAccess: vi.fn(async () =>
        NextResponse.json({ error: 'غير مصرح' }, { status: 401 }),
      ),
    }));
    vi.doMock('@/lib/db', () => ({ getPool: vi.fn() }));

    const { POST } = await import('@/app/api/admin/store/clear/route');
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('cashier without page access receives 403', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      isAuthResult: (v: { ok?: boolean }) => v?.ok === true,
      requirePageAccess: vi.fn(async () =>
        NextResponse.json({ error: 'غير مصرح' }, { status: 403 }),
      ),
    }));
    vi.doMock('@/lib/db', () => ({ getPool: vi.fn() }));

    const { POST } = await import('@/app/api/admin/store/clear/route');
    const res = await POST();
    expect(res.status).toBe(403);
  });
});
