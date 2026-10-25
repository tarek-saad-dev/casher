/**
 * Core tenant isolation regression: a tenant-stamped branch is not trusted
 * until its active Location is verified inside that tenant.
 */
import { describe, expect, it, vi } from 'vitest';
import type { TenantSqlExecutor } from '@/platform/tenant/tenantContext';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  sql: { Int: 'Int', UniqueIdentifier: 'UniqueIdentifier' },
  getPool: vi.fn(async () => {
    throw new Error('Unexpected global DB pool use');
  }),
}));

import { tenantIdForBranchContext } from '@/platform/masterData/tenantScope';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Location = {
  tenantId: string;
  branchId: number;
  locationId: string;
  status: 'active' | 'inactive';
};

const locations: Location[] = [
  { tenantId: A, branchId: 1, locationId: 'a-1', status: 'active' },
  { tenantId: B, branchId: 2, locationId: 'b-2', status: 'active' },
  { tenantId: A, branchId: 7, locationId: 'a-7', status: 'active' },
  { tenantId: B, branchId: 7, locationId: 'b-7', status: 'active' },
  { tenantId: B, branchId: 8, locationId: 'b-8', status: 'inactive' },
];

function fakeSql(locationsForTest: Location[] = locations) {
  const statements: Array<{ sqlText: string; bindings: Record<string, unknown> }> = [];
  const executor = {
    request() {
      const bindings: Record<string, unknown> = {};
      const request = {
        input(name: string, _type: unknown, value: unknown) {
          bindings[name] = value;
          return request;
        },
        async query(sqlText: string) {
          statements.push({ sqlText, bindings: { ...bindings } });
          if (sqlText.includes('SELECT DISTINCT l.TenantId')) {
            const tenants = new Set(
              locationsForTest
                .filter((l) => l.branchId === bindings.branchId && l.status === 'active')
                .map((l) => l.tenantId),
            );
            return { recordset: [...tenants].map((TenantId) => ({ TenantId })) };
          }
          if (sqlText.includes('SELECT LocationId, LegacyBranchId, BranchCode, Timezone')) {
            return {
              recordset: locationsForTest
                .filter(
                  (l) =>
                    l.tenantId === String(bindings.tenantId).toLowerCase() &&
                    l.branchId === bindings.branchId &&
                    l.status === 'active',
                )
                .map((l) => ({
                  LocationId: l.locationId,
                  LegacyBranchId: l.branchId,
                  BranchCode: l.locationId,
                  Timezone: 'Africa/Cairo',
                })),
            };
          }
          throw new Error('Unexpected SQL query in tenant scope test');
        },
      };
      return request;
    },
  };
  return { executor: executor as unknown as TenantSqlExecutor, statements };
}

describe('Core: stamped branch tenant isolation', () => {
  it('accepts a valid stamp only after a tenant-and-branch scoped Location read', async () => {
    const db = fakeSql();
    await expect(tenantIdForBranchContext({ branchId: 1, tenantId: A.toUpperCase() }, db.executor)).resolves.toBe(A);
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0].bindings).toMatchObject({ tenantId: A, branchId: 1 });
    expect(db.statements[0].sqlText).toContain('TenantId = @tenantId AND LegacyBranchId = @branchId');
  });

  it('rejects a cross-tenant stamp without revealing the other tenant or branch', async () => {
    const db = fakeSql();
    await expect(tenantIdForBranchContext({ branchId: 2, tenantId: A }, db.executor)).rejects.toMatchObject({
      code: 'LOCATION_NOT_IN_TENANT',
      status: 404,
      publicCode: 'NOT_FOUND',
      publicMessage: 'غير موجود',
    });
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0].bindings).toMatchObject({ tenantId: A, branchId: 2 });
  });

  it('rejects an inactive branch even if the tenant stamp is correct', async () => {
    const db = fakeSql();
    await expect(tenantIdForBranchContext({ branchId: 8, tenantId: B }, db.executor)).rejects.toMatchObject({
      code: 'LOCATION_NOT_IN_TENANT',
    });
  });

  it('uses the stamp to resolve overlapping local branch identifiers independently', async () => {
    const db = fakeSql();
    await expect(tenantIdForBranchContext({ branchId: 7, tenantId: A }, db.executor)).resolves.toBe(A);
    await expect(tenantIdForBranchContext({ branchId: 7, tenantId: B }, db.executor)).resolves.toBe(B);
    expect(db.statements.map((s) => s.bindings.tenantId)).toEqual([A, B]);
  });

  it('keeps the unstamped compatibility path fail-closed on ambiguous ownership', async () => {
    const db = fakeSql();
    await expect(tenantIdForBranchContext({ branchId: 7 }, db.executor)).rejects.toMatchObject({
      code: 'TENANT_AMBIGUOUS',
    });
    await expect(tenantIdForBranchContext({ branchId: 1 }, db.executor)).resolves.toBe(A);
  });

  it('rejects invalid stamps and branch IDs before issuing SQL', async () => {
    const db = fakeSql();
    await expect(tenantIdForBranchContext({ branchId: 1, tenantId: 'not-a-guid' }, db.executor)).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_UNRESOLVED',
    });
    await expect(tenantIdForBranchContext({ branchId: 0, tenantId: A }, db.executor)).rejects.toMatchObject({
      code: 'LOCATION_NOT_IN_TENANT',
    });
    expect(db.statements).toHaveLength(0);
  });
});
