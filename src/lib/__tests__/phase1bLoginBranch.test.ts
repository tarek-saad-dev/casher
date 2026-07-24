import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { BranchDomainError } from '@/lib/branch/types';

vi.mock('server-only', () => ({}));

function mockSessionModule(createSession = vi.fn(async () => undefined)) {
  vi.doMock('@/lib/session', () => ({
    createSession,
    assertSessionSecretConfigured: () => undefined,
    SessionConfigError: class SessionConfigError extends Error {
      code = 'SESSION_CONFIG_ERROR';
      constructor(message: string) {
        super(message);
        this.name = 'SessionConfigError';
      }
    },
  }));
  return createSession;
}

describe('Phase 1B login branch gating', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  function mockDbUser(user: Record<string, unknown> | null) {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => ({
        request: () => {
          const api = {
            input: () => api,
            query: async () => ({ recordset: user ? [user] : [] }),
          };
          return api;
        },
      })),
      sql: { NVarChar: (n: number) => n, Int: 'Int' },
      getUserFriendlyError: (err: unknown) =>
        err instanceof Error ? err.message : 'error',
    }));
  }

  it('logs in with a valid default GLEEM mapping and returns authoritative permissions', async () => {
    mockDbUser({
      UserID: 10,
      UserName: 'Cashier',
      UserLevel: 'user',
      loginName: 'cashier',
      ShiftID: 1,
    });
    const createSession = mockSessionModule();
    vi.doMock('@/lib/branch/access', () => ({
      resolveLoginDefaultBranch: vi.fn(async () => ({
        id: 1,
        userId: 10,
        branchId: 7,
        branchCode: 'GLEEM',
        branchName: 'جليم – سابا باشا',
        shortName: 'جليم',
        isDefault: true,
        canOperate: true,
        canViewReports: false,
        canSwitch: false,
        isActive: true,
        validFrom: new Date(),
        validTo: null,
        branchIsActive: true,
      })),
    }));
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(async () => ({
        defaultLandingPath: '/income/pos',
        isPartnerOnly: false,
        roles: ['cashier'],
        allowedPagePaths: ['/income/pos'],
        allowedPageKeys: ['income.pos'],
        isSuperAdmin: false,
      })),
    }));

    const { POST } = await import('@/app/api/auth/login/route');
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginName: 'cashier', password: 'x' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ActiveBranchCode).toBe('GLEEM');
    expect(body.ActiveBranchID).toBe(7);
    expect(body.BranchSessionVersion).toBe(1);
    expect(body.roles).toEqual(['cashier']);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ActiveBranchID: 7,
        ActiveBranchCode: 'GLEEM',
        BranchSessionVersion: 1,
      }),
    );
  });

  it('rejects missing SESSION_SECRET in production before DB work', async () => {
    class SessionConfigError extends Error {
      code = 'SESSION_CONFIG_ERROR' as const;
      constructor(message: string) {
        super(message);
        this.name = 'SessionConfigError';
      }
    }
    const getPool = vi.fn();
    vi.doMock('@/lib/db', () => ({
      getPool,
      sql: { NVarChar: (n: number) => n },
      getUserFriendlyError: () => 'masked',
    }));
    vi.doMock('@/lib/session', () => ({
      createSession: vi.fn(),
      assertSessionSecretConfigured: () => {
        throw new SessionConfigError('SESSION_SECRET must be configured in production');
      },
      SessionConfigError,
    }));
    vi.doMock('@/lib/branch/access', () => ({
      resolveLoginDefaultBranch: vi.fn(),
    }));
    vi.doMock('@/lib/permissions-server', () => ({ getUserAccess: vi.fn() }));

    const { POST } = await import('@/app/api/auth/login/route');
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginName: 'cashier', password: 'x' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('SESSION_CONFIG_ERROR');
    expect(getPool).not.toHaveBeenCalled();
  });

  it('rejects missing mapping', async () => {
    mockDbUser({
      UserID: 11,
      UserName: 'NoMap',
      UserLevel: 'user',
      loginName: 'nomap',
      ShiftID: 1,
    });
    mockSessionModule();
    vi.doMock('@/lib/branch/access', () => ({
      resolveLoginDefaultBranch: vi.fn(async () => {
        throw new BranchDomainError('NO_DEFAULT_BRANCH', 'لا يوجد فرع', 403);
      }),
    }));
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(),
    }));
    const { POST } = await import('@/app/api/auth/login/route');
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginName: 'nomap', password: 'x' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_DEFAULT_BRANCH');
  });

  it('rejects expired, inactive mapping, inactive branch, and multiple defaults', async () => {
    const cases = [
      'BRANCH_ACCESS_EXPIRED',
      'BRANCH_ACCESS_INACTIVE',
      'BRANCH_INACTIVE',
      'MULTIPLE_DEFAULT_BRANCHES',
    ] as const;
    for (const code of cases) {
      vi.resetModules();
      mockDbUser({
        UserID: 12,
        UserName: 'U',
        UserLevel: 'user',
        loginName: 'u',
        ShiftID: 1,
      });
      mockSessionModule();
      vi.doMock('@/lib/branch/access', () => ({
        resolveLoginDefaultBranch: vi.fn(async () => {
          throw new BranchDomainError(code, code, 403);
        }),
      }));
      vi.doMock('@/lib/permissions-server', () => ({ getUserAccess: vi.fn() }));
      const { POST } = await import('@/app/api/auth/login/route');
      const req = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ loginName: 'u', password: 'x' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe(code);
    }
  });

  it('rejects deleted users at credential query time', async () => {
    mockDbUser(null);
    mockSessionModule();
    vi.doMock('@/lib/branch/access', () => ({
      resolveLoginDefaultBranch: vi.fn(),
    }));
    vi.doMock('@/lib/permissions-server', () => ({ getUserAccess: vi.fn() }));
    const { POST } = await import('@/app/api/auth/login/route');
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginName: 'gone', password: 'x' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('INVALID_CREDENTIALS');
  });
});

describe('Phase 1B soft-delete session invalidation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects an existing cookie after the user is soft-deleted', async () => {
    const destroySession = vi.fn(async () => undefined);
    vi.doMock('@/lib/session', () => ({
      getSession: vi.fn(async () => ({
        UserID: 5,
        UserName: 'WasActive',
        UserLevel: 'user',
        ActiveBranchID: 1,
        ActiveBranchCode: 'GLEEM',
        BranchSessionVersion: 1,
      })),
      destroySession,
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({
        exists: true,
        isDeleted: true,
        userName: 'WasActive',
        userLevel: 'user',
      })),
    }));
    vi.doMock('@/lib/permissions-server', () => ({
      getUserAccess: vi.fn(),
    }));

    const { authenticate, isAuthResult } = await import('@/lib/api-auth');
    const result = await authenticate();
    expect(isAuthResult(result)).toBe(false);
    expect(destroySession).toHaveBeenCalled();
  });
});
