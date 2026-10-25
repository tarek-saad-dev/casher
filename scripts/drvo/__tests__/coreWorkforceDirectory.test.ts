import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  sqls: [] as string[],
  binds: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db', () => ({
  sql: { UniqueIdentifier: 'guid', Int: 'int', Date: 'date' },
  getPool: async () => ({
    request: () => {
      const bind: Record<string, unknown> = {};
      return {
        input(name: string, _type: unknown, value: unknown) {
          bind[name] = value;
          return this;
        },
        async query(query: string) {
          h.sqls.push(query);
          h.binds.push({ ...bind });
          return { recordset: h.rows };
        },
      };
    },
  }),
}));

import { createLegacyWorkforceDirectoryAdapter } from '@/shared/workforce/public';
import type { ActorContext } from '@/platform/auth/actorContext';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOCATION_A = '11111111-1111-4111-8111-111111111111';
const LOCATION_B = '22222222-2222-4222-8222-222222222222';
const as = (tenantId: string | null): ActorContext => ({
  actorType: 'staff',
  actorId: '5',
  tenantId,
  membershipId: 'membership',
  viewLocationId: LOCATION_A,
});

beforeEach(() => {
  h.sqls.length = 0;
  h.binds.length = 0;
  h.rows = [];
});

describe('Core Workforce Directory — tenant and location boundaries', () => {
  const port = createLegacyWorkforceDirectoryAdapter();

  it('lists active employees with a tenant predicate, not a process-global branch', async () => {
    h.rows = [{ EmpID: 8, EmpName: 'Ahmed', Job: 'Barber', isActive: true }];
    const out = await port.listEmployees(as(A));
    expect(out).toEqual([{ employeeId: 8, displayName: 'Ahmed', job: 'Barber', isActive: true }]);
    expect(h.binds[0]).toMatchObject({ tenantId: A });
    expect(h.sqls[0]).toContain('e.TenantId = @tenantId');
    expect(h.sqls[0]).toContain('ISNULL(e.isActive, 1) = 1');
    expect(h.sqls[0]).not.toContain('CASHER_BOOT');
  });

  it('scopes a dated branch roster to an active Location AND active assignment', async () => {
    await port.listEmployees(as(B), { location: { locationId: LOCATION_B, onDate: '2026-10-26' } });
    expect(h.binds[0]).toMatchObject({ tenantId: B, locationId: LOCATION_B, assignmentDate: '2026-10-26' });
    const q = h.sqls[0];
    for (const predicate of [
      'e.TenantId = @tenantId', 'l.TenantId = @tenantId',
      'l.LocationId = @locationId', "l.Status = N'active'",
      'a.EmpID = e.EmpID', 'a.BranchID = l.LegacyBranchId',
      'a.IsActive = 1', 'a.EffectiveFrom <= @assignmentDate',
      'a.EffectiveTo >= @assignmentDate', 'b.IsActive = 1',
    ]) {
      expect(q).toContain(predicate);
    }
    expect(q).not.toContain(LOCATION_A);
  });

  it('uses identical scope for by-id lookup and returns null for unknown/cross-tenant id', async () => {
    const item = await port.getEmployee(as(A), 88, { location: { locationId: LOCATION_A, onDate: '2026-10-26' } });
    expect(item).toBeNull();
    expect(h.binds[0]).toMatchObject({ tenantId: A, employeeId: 88, locationId: LOCATION_A });
    expect(h.sqls[0]).toContain('e.EmpID = @employeeId');
    expect(h.sqls[0]).toContain('l.TenantId = @tenantId');
  });

  it('does not offer a location or employee from another tenant if the SQL returns no row', async () => {
    const scoped = { location: { locationId: LOCATION_B, onDate: '2026-10-26' } };
    expect(await port.getEmployee(as(A), 123, scoped)).toBeNull();
    expect(await port.listEmployees(as(A), scoped)).toEqual([]);
    expect(h.binds.every((b) => b.tenantId === A && b.locationId === LOCATION_B)).toBe(true);
  });

  it('rejects absent and malformed TenantId before executing any query', async () => {
    await expect(port.listEmployees(as(null))).rejects.toThrow('تعذر تحديد المنشأة');
    await expect(port.listEmployees(as('not-guid'))).rejects.toThrow('تعذر تحديد المنشأة');
    expect(h.sqls).toHaveLength(0);
  });

  it('rejects forged LocationId, impossible dates and implicit today', async () => {
    for (const location of [
      { locationId: 'GLEEM', onDate: '2026-10-26' },
      { locationId: LOCATION_A, onDate: '2026-02-30' },
      { locationId: LOCATION_A, onDate: '' },
      { locationId: LOCATION_A, onDate: '2026-1-1' },
    ]) {
      await expect(port.listEmployees(as(A), { location })).rejects.toThrow();
    }
    expect(h.sqls).toHaveLength(0);
  });

  it('returns null for invalid employee IDs and never queries with injected identifiers', async () => {
    expect(await port.getEmployee(as(A), -1)).toBeNull();
    expect(await port.getEmployee(as(A), Number.NaN)).toBeNull();
    expect(await port.getEmployee(as(A), 1.2)).toBeNull();
    expect(h.sqls).toHaveLength(0);
  });

  it('only includes inactive employees when explicitly requested', async () => {
    h.rows = [{ EmpID: 4, EmpName: 'Inactive', Job: null, isActive: false }];
    const found = await port.listEmployees(as(A), { includeInactive: true });
    expect(found[0]?.isActive).toBe(false);
    expect(h.sqls[0]).not.toContain('ISNULL(e.isActive, 1) = 1');
  });
});
