/**
 * DRVO-013 — Tenant A staff cannot read or write Tenant B users through /api/users/[id].
 * Cross-tenant ids answer exactly like missing ids and never reach a write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** Tenant A: users 10, 11 and branch 1. Tenant B: user 20 and branch 7. */
const USERS: Record<string, number[]> = { [A]: [10, 11], [B]: [20] };
const BRANCHES: Record<string, number[]> = { [A]: [1], [B]: [7] };

const queries = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/db', () => ({
  sql: { Int: () => ({}), NVarChar: () => ({}) },
  getPool: vi.fn(async () => ({
    request() {
      const req = {
        input: () => req,
        async query(text: string) {
          queries.push(text.replace(/\s+/g, ' ').trim());
          return { recordset: [{ UserID: 11, UserName: 'same-tenant' }], rowsAffected: [1] };
        },
      };
      return req;
    },
  })),
}));
vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({
    UserID: 10,
    UserName: 'admin-a',
    UserLevel: 'admin',
    ActiveBranchID: 1,
    ActiveBranchCode: 'A-MAIN',
    BranchSessionVersion: 1,
    TenantId: A,
    MembershipId: 'm-a-10',
  })),
}));
vi.mock('@/lib/permissions', () => ({ hasPermission: () => true }));
vi.mock('@/lib/branch/userLoginBranch', () => ({
  grantStaffAccessToAllActiveBranches: vi.fn(async () => ({ branchId: 1, branchCode: 'A-MAIN', branchName: 'A' })),
}));
vi.mock('@/lib/branch/access', () => ({ validateUserBranchAccess: vi.fn(async () => ({ canOperate: true })) }));
vi.mock('@/lib/branch/operationalGates', () => ({ branchErrorResponse: () => null }));
vi.mock('@/platform/tenant/tenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/tenant/tenantContext')>();
  return {
    ...actual,
    assertLegacyUserInTenant: vi.fn(async (tenantId: string, userId: number) => {
      if (!(USERS[tenantId] ?? []).includes(userId)) {
        throw new actual.TenantContextError('USER_NOT_IN_TENANT', 'cross-tenant');
      }
      return 'm';
    }),
    assertLegacyBranchInTenant: vi.fn(async (tenantId: string, branchId: number) => {
      if (!(BRANCHES[tenantId] ?? []).includes(branchId)) {
        throw new actual.TenantContextError('LOCATION_NOT_IN_TENANT', 'cross-tenant');
      }
      return { locationId: 'l', legacyBranchId: branchId, branchCode: 'X', timezone: 'Africa/Cairo' };
    }),
  };
});

const { GET, PUT, DELETE } = await import('@/app/api/users/[id]/route');

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const jsonReq = (body: unknown) =>
  new Request('http://localhost/api/users/x', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
const plainReq = () => new Request('http://localhost/api/users/x') as unknown as NextRequest;
const writes = () => queries.filter((q) => /^UPDATE/i.test(q));

beforeEach(() => {
  queries.length = 0;
});

describe('DRVO-013 /api/users/[id] tenant isolation', () => {
  it('GET of a Tenant B user is the same 404 as a missing user, without reading TblUser', async () => {
    const cross = await GET(plainReq(), params(20));
    const missing = await GET(plainReq(), params(999));
    expect(cross.status).toBe(404);
    expect(await cross.json()).toEqual(await missing.json());
    expect(queries).toEqual([]);
  });

  it('PUT of a Tenant B user is 404 and never writes', async () => {
    const res = await PUT(jsonReq({ UserName: 'pwned' }), params(20));
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it('PUT cannot move a Tenant A user into a Tenant B branch', async () => {
    const res = await PUT(jsonReq({ UserName: 'x', BranchID: 7 }), params(11));
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it('DELETE of a Tenant B user is 404 and never writes', async () => {
    const res = await DELETE(plainReq(), params(20));
    expect(res.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it('same-tenant reads and writes still work', async () => {
    expect((await GET(plainReq(), params(11))).status).toBe(200);
    expect((await PUT(jsonReq({ UserName: 'ok', BranchID: 1 }), params(11))).status).toBe(200);
    expect(writes()).toHaveLength(1);
  });
});
