/**
 * DRVO-013 — authoritative tenant context & isolation, proven against two synthetic tenants.
 * A fake SQL layer models Tenant / Location / TenantMembership / Bookings / TblBookingHold /
 * PlatformOutbox; UNIQUEIDENTIFIERs come back upper-case like SQL Server does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const up = (id: string) => id.toUpperCase();

type OutboxRow = {
  Id: number;
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventType: string;
  Payload: string;
  IdempotencyKey: string | null;
  CorrelationId: string | null;
  OccurredAt: Date;
  Status: 'pending' | 'delivering' | 'delivered' | 'dead';
  Attempts: number;
};

const db = vi.hoisted(() => ({
  tenants: [] as Array<{ TenantId: string; Code: string; Status: string }>,
  locations: [] as Array<{
    LocationId: string;
    TenantId: string;
    LegacyBranchId: number;
    BranchCode: string;
    Timezone: string;
    Status: string;
  }>,
  memberships: [] as Array<{ MembershipId: string; TenantId: string; LegacyUserId: number }>,
  bookings: [] as Array<{ BookingCode: string; BranchID: number }>,
  holds: [] as Array<{ HoldKey: string; BranchID: number; Status: string }>,
  outbox: [] as OutboxRow[],
  settles: [] as Array<{ id: number; tenantId: string; status: string }>,
}));

vi.mock('@/lib/db', () => {
  const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
  const typeFn = () => ({});
  const sql = {
    Int: typeFn,
    BigInt: typeFn,
    UniqueIdentifier: typeFn,
    NVarChar: typeFn,
    MAX: -1,
  };

  function run(text: string, p: Record<string, unknown>): { recordset: unknown[]; rowsAffected: number[] } {
    const t = text.replace(/\s+/g, ' ');
    const activeTenant = (id: string) => db.tenants.find((x) => same(x.TenantId, id) && x.Status === 'active');

    if (/FROM dbo\.TenantMembership m INNER JOIN dbo\.Tenant t/.test(t)) {
      const rows = db.memberships
        .filter((m) => m.LegacyUserId === p.userId && activeTenant(m.TenantId))
        .map((m) => ({ MembershipId: m.MembershipId, TenantId: up(m.TenantId), Code: activeTenant(m.TenantId)!.Code }));
      return { recordset: rows, rowsAffected: [rows.length] };
    }
    if (/SELECT MembershipId FROM dbo\.TenantMembership/.test(t)) {
      const rows = db.memberships
        .filter((m) => same(m.TenantId, p.tenantId) && m.LegacyUserId === p.userId)
        .map((m) => ({ MembershipId: m.MembershipId }));
      return { recordset: rows, rowsAffected: [rows.length] };
    }
    if (/FROM dbo\.Location l INNER JOIN dbo\.Tenant t/.test(t)) {
      const rows = db.locations
        .filter((l) => l.Status === 'active' && activeTenant(l.TenantId))
        .filter((l) => ('branchCode' in p ? l.BranchCode === p.branchCode : l.LegacyBranchId === p.branchId))
        .map((l) => ({ ...l, TenantId: up(l.TenantId), Code: activeTenant(l.TenantId)!.Code }));
      return { recordset: rows, rowsAffected: [rows.length] };
    }
    if (/FROM dbo\.Location WHERE TenantId = @tenantId AND LegacyBranchId = @branchId/.test(t)) {
      const rows = db.locations.filter(
        (l) => same(l.TenantId, p.tenantId) && l.LegacyBranchId === p.branchId && l.Status === 'active',
      );
      return { recordset: rows, rowsAffected: [rows.length] };
    }
    if (/SELECT LegacyBranchId FROM dbo\.Location/.test(t)) {
      const rows = db.locations.filter((l) => same(l.TenantId, p.tenantId) && l.Status === 'active');
      return { recordset: rows, rowsAffected: [rows.length] };
    }
    if (/FROM dbo\.Bookings WHERE BookingCode = @code/.test(t)) {
      const rows = db.bookings.filter((b) => b.BookingCode === p.code).slice(0, 1);
      return { recordset: rows, rowsAffected: [rows.length] };
    }
    if (/FROM dbo\.TblBookingHold/.test(t)) {
      const suffix = String(p.suffix);
      const rows = db.holds.filter(
        (h) => h.Status === 'active' && h.HoldKey.startsWith('t:') && h.HoldKey.endsWith(suffix),
      );
      return { recordset: rows, rowsAffected: [rows.length] };
    }
    if (/WITH next AS/.test(t)) {
      const types = Object.keys(p).filter((k) => /^et\d+$/.test(k)).map((k) => p[k]);
      const claimed = db.outbox
        .filter((r) => r.Status === 'pending')
        .filter((r) => (p.tenantId ? same(r.TenantId, p.tenantId) : true))
        .filter((r) => (types.length ? types.includes(r.EventType) : true))
        .sort((x, y) => x.Id - y.Id)
        .slice(0, Number(p.batch));
      for (const r of claimed) {
        r.Status = 'delivering';
        r.Attempts += 1;
      }
      return { recordset: claimed.map((r) => ({ ...r })), rowsAffected: [claimed.length] };
    }
    if (/UPDATE dbo\.PlatformOutbox SET Status = @status/.test(t)) {
      db.settles.push({ id: Number(p.id), tenantId: String(p.tenantId), status: String(p.status) });
      const row = db.outbox.find(
        (r) => r.Id === Number(p.id) && same(r.TenantId, p.tenantId) && r.Status === 'delivering',
      );
      if (row) row.Status = p.status as OutboxRow['Status'];
      return { recordset: [], rowsAffected: [row ? 1 : 0] };
    }
    throw new Error(`fake db: unhandled query ${t.slice(0, 120)}`);
  }

  const pool = {
    request() {
      const params: Record<string, unknown> = {};
      const req = {
        input(name: string, _type: unknown, value?: unknown) {
          params[name] = value;
          return req;
        },
        async query(text: string) {
          return run(text, params);
        },
      };
      return req;
    },
  };
  return { sql, getPool: vi.fn(async () => pool) };
});

const apps = vi.hoisted(() => ({ installed: {} as Record<string, string[]>, loads: [] as string[] }));
const subs = vi.hoisted(() => ({ active: {} as Record<string, boolean>, loads: [] as string[] }));

vi.mock('@/platform/apps/tenantApps', () => ({
  listTenantApps: vi.fn(async (tenantId: string) => {
    apps.loads.push(tenantId);
    return (apps.installed[tenantId] ?? []).map((appCode) => ({ appCode, status: 'installed' }));
  }),
  installedAppCodes: (rows: Array<{ appCode: string }>) => rows.map((r) => r.appCode),
}));
vi.mock('@/platform/commercial/planRepository', () => ({
  getTenantSubscription: vi.fn(async (_db: unknown, tenantId: string) => {
    subs.loads.push(tenantId);
    return subs.active[tenantId] ? { tenantId, planCode: 'starter' } : null;
  }),
  getPlan: vi.fn(async () => ({ code: 'starter' })),
}));
vi.mock('@/platform/commercial/subscriptionLifecycle', () => ({
  evaluateSubscription: (sub: unknown) =>
    sub ? { allowed: true, reason: 'ACTIVE' } : { allowed: false, reason: 'NO_SUBSCRIPTION' },
}));

import {
  assertLegacyBranchInTenant,
  assertLegacyUserInTenant,
  buildJobTenantContext,
  listTenantLegacyBranchIds,
  requireActorTenantId,
  resolvePublicTenantContext,
  resolveStaffTenantContextForRequest,
  resolveUserTenantMembership,
  TenantContextError,
} from '@/platform/tenant/tenantContext';
import { TenantScopedMemo, tenantIdempotencyKey } from '@/platform/tenant/tenantMemo';
import { tenantLockResource } from '@/platform/tenant/tenantLockResource';
import { tenantCacheKey } from '@/platform/tenant/tenantCacheKey';
import { resolveLegacyBootstrapTenantId } from '@/platform/tenant/legacyBootstrapSeam';
import {
  assertTenantAppInstalled,
  assertTenantSubscriptionActive,
  invalidateTenantAccessGate,
  resetTenantAccessGate,
  TenantAccessDeniedError,
} from '@/platform/commercial/tenantAccessGate';
import { processPlatformOutboxTick, claimPlatformOutboxBatch } from '@/platform/outbox/consumer';
import { namespacedRequestKey } from '@/apps/booking/application/tenantRequestKey';
import { namespacedHoldKey } from '@/apps/booking/application/holdBooking';
import {
  resolvePublicTenantForBookingCode,
  resolvePublicTenantForBranchCode,
  resolvePublicTenantForBranchId,
  resolvePublicTenantForHoldKey,
} from '@/lib/booking/publicBookingTenant';

function seed() {
  db.tenants = [
    { TenantId: A, Code: 'TENANT_A', Status: 'active' },
    { TenantId: B, Code: 'TENANT_B', Status: 'active' },
  ];
  db.locations = [
    { LocationId: 'loc-a1', TenantId: A, LegacyBranchId: 1, BranchCode: 'A-MAIN', Timezone: 'Africa/Cairo', Status: 'active' },
    { LocationId: 'loc-a2', TenantId: A, LegacyBranchId: 2, BranchCode: 'A-TWO', Timezone: 'Africa/Cairo', Status: 'active' },
    { LocationId: 'loc-b7', TenantId: B, LegacyBranchId: 7, BranchCode: 'B-MAIN', Timezone: 'Asia/Riyadh', Status: 'active' },
    { LocationId: 'loc-b8', TenantId: B, LegacyBranchId: 8, BranchCode: 'B-CLOSED', Timezone: 'Asia/Riyadh', Status: 'inactive' },
  ];
  db.memberships = [
    { MembershipId: 'm-a-10', TenantId: A, LegacyUserId: 10 },
    { MembershipId: 'm-b-20', TenantId: B, LegacyUserId: 20 },
    { MembershipId: 'm-a-30', TenantId: A, LegacyUserId: 30 },
    { MembershipId: 'm-b-30', TenantId: B, LegacyUserId: 30 },
  ];
  db.bookings = [
    { BookingCode: 'BK-AAAA2', BranchID: 1 },
    { BookingCode: 'BK-BBBB2', BranchID: 7 },
  ];
  db.holds = [
    { HoldKey: `t:${A}:only-a`, BranchID: 1, Status: 'active' },
    { HoldKey: `t:${A}:shared`, BranchID: 1, Status: 'active' },
    { HoldKey: `t:${B}:shared`, BranchID: 7, Status: 'active' },
    { HoldKey: `t:${B}:forged`, BranchID: 1, Status: 'active' },
  ];
  db.outbox = [];
  db.settles = [];
}

function outboxRow(id: number, tenantId: string, overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    Id: id,
    TenantId: tenantId,
    AggregateType: 'booking',
    AggregateId: `agg-${id}`,
    EventType: 'booking.created',
    Payload: '{}',
    IdempotencyKey: `idem-${id}`,
    CorrelationId: null,
    OccurredAt: new Date('2026-01-01T00:00:00Z'),
    Status: 'pending',
    Attempts: 0,
    ...overrides,
  };
}

async function expectTenantError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(TenantContextError);
  await expect(p).rejects.toMatchObject({ code });
}

beforeEach(() => {
  seed();
  apps.installed = {};
  apps.loads = [];
  subs.active = {};
  subs.loads = [];
  resetTenantAccessGate();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('DRVO-013 canonical resolver: user -> TenantMembership -> Tenant -> Location', () => {
  it('resolves each single-tenant user to their own tenant (lower-cased)', async () => {
    await expect(resolveUserTenantMembership({ userId: 10 })).resolves.toMatchObject({
      tenantId: A,
      tenantCode: 'TENANT_A',
      membershipId: 'm-a-10',
    });
    await expect(resolveUserTenantMembership({ userId: 20 })).resolves.toMatchObject({ tenantId: B });
  });

  it('never defaults: no membership and multiple memberships both fail closed', async () => {
    await expectTenantError(resolveUserTenantMembership({ userId: 99 }), 'TENANT_CONTEXT_UNRESOLVED');
    await expectTenantError(resolveUserTenantMembership({ userId: 30 }), 'TENANT_AMBIGUOUS');
  });

  it('the session tenant selects among memberships and must be one of them', async () => {
    await expect(resolveUserTenantMembership({ userId: 30, preferredTenantId: up(B) })).resolves.toMatchObject({
      tenantId: B,
      membershipId: 'm-b-30',
    });
    await expectTenantError(
      resolveUserTenantMembership({ userId: 10, preferredTenantId: B }),
      'TENANT_MEMBERSHIP_MISMATCH',
    );
  });

  it('an inactive tenant is never resolved', async () => {
    db.tenants[1].Status = 'suspended';
    await expectTenantError(resolveUserTenantMembership({ userId: 20 }), 'TENANT_CONTEXT_UNRESOLVED');
    await expect(resolveUserTenantMembership({ userId: 30 })).resolves.toMatchObject({ tenantId: A });
  });

  it('staff context requires the active branch to be a Location of the resolved tenant', async () => {
    const ctx = await resolveStaffTenantContextForRequest({ userId: 10, activeBranchId: 2 });
    expect(ctx).toMatchObject({ kind: 'staff', tenantId: A, activeLocation: { locationId: 'loc-a2' } });
    await expectTenantError(
      resolveStaffTenantContextForRequest({ userId: 10, activeBranchId: 7 }),
      'LOCATION_NOT_IN_TENANT',
    );
  });
});

describe('DRVO-013 cross-tenant branch / user / location access fails non-disclosing', () => {
  it('Tenant A cannot address a branch of Tenant B (and vice versa)', async () => {
    await expect(assertLegacyBranchInTenant(A, 1)).resolves.toMatchObject({ locationId: 'loc-a1' });
    await expectTenantError(assertLegacyBranchInTenant(A, 7), 'LOCATION_NOT_IN_TENANT');
    await expectTenantError(assertLegacyBranchInTenant(B, 1), 'LOCATION_NOT_IN_TENANT');
    await expectTenantError(assertLegacyBranchInTenant(B, 8), 'LOCATION_NOT_IN_TENANT');
  });

  it('Tenant A cannot address a user of Tenant B', async () => {
    await expect(assertLegacyUserInTenant(A, 10)).resolves.toBe('m-a-10');
    await expectTenantError(assertLegacyUserInTenant(A, 20), 'USER_NOT_IN_TENANT');
    await expectTenantError(assertLegacyUserInTenant(B, 10), 'USER_NOT_IN_TENANT');
  });

  it('cross-tenant failures map to the same public 404 as a missing record', async () => {
    const err = await assertLegacyBranchInTenant(A, 7).catch((e) => e as TenantContextError);
    const missing = await assertLegacyBranchInTenant(A, 999).catch((e) => e as TenantContextError);
    const user = await assertLegacyUserInTenant(A, 20).catch((e) => e as TenantContextError);
    for (const e of [err, missing, user]) {
      expect(e).toMatchObject({ status: 404, publicCode: 'NOT_FOUND', publicMessage: 'غير موجود' });
      expect(e.message).toBe('غير موجود');
      expect(e.message).not.toContain(A);
    }
    expect(err.detail).toContain('Branch 7');
  });

  it('tenant branch listings are disjoint', async () => {
    expect([...(await listTenantLegacyBranchIds(A))].sort()).toEqual([1, 2]);
    expect([...(await listTenantLegacyBranchIds(B))]).toEqual([7]);
  });
});

describe('DRVO-013 public booking tenant derivation', () => {
  it('derives the owning tenant from the public branch code', async () => {
    expect((await resolvePublicTenantForBranchCode('A-MAIN', 'test'))?.tenantId).toBe(A);
    expect((await resolvePublicTenantForBranchCode('B-MAIN', 'test'))?.tenantId).toBe(B);
    expect((await resolvePublicTenantForBranchId(7, 'test'))?.location.branchCode).toBe('B-MAIN');
  });

  it('unknown, inactive and empty identities resolve to nothing (no default tenant)', async () => {
    expect(await resolvePublicTenantForBranchCode('NOPE', 'test')).toBeNull();
    expect(await resolvePublicTenantForBranchCode('B-CLOSED', 'test')).toBeNull();
    expect(await resolvePublicTenantForBranchCode('', 'test')).toBeNull();
    expect(await resolvePublicTenantForBranchCode(undefined, 'test')).toBeNull();
    expect(await resolvePublicTenantForBranchId(0, 'test')).toBeNull();
  });

  it('a branch mapped to two tenants is ambiguous and fails closed', async () => {
    db.locations.push({ ...db.locations[0], LocationId: 'dup', TenantId: B });
    await expectTenantError(resolvePublicTenantContext({ branchCode: 'A-MAIN' }), 'TENANT_AMBIGUOUS');
    expect(await resolvePublicTenantForBranchCode('A-MAIN', 'test')).toBeNull();
  });

  it('internal ops: a staff member of Tenant A cannot book into a Tenant B branch', async () => {
    expect(await resolvePublicTenantForBranchCode('B-MAIN', 'test', { staffTenantId: A })).toBeNull();
    expect((await resolvePublicTenantForBranchCode('A-MAIN', 'test', { staffTenantId: up(A) }))?.tenantId).toBe(A);
  });

  it('booking-code routes resolve the tenant that owns the booking', async () => {
    await expect(resolvePublicTenantForBookingCode('bk-aaaa2', 'test')).resolves.toMatchObject({
      ok: true,
      tenant: { tenantId: A },
    });
    await expect(resolvePublicTenantForBookingCode('BK-BBBB2', 'test')).resolves.toMatchObject({
      ok: true,
      tenant: { tenantId: B },
    });
    await expect(resolvePublicTenantForBookingCode('BK-ZZZZ9', 'test')).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    await expect(resolvePublicTenantForBookingCode('12345', 'test')).resolves.toEqual({
      ok: false,
      reason: 'invalid_code',
    });
  });

  it('hold release resolves only an unambiguous hold whose prefix matches the branch tenant', async () => {
    expect((await resolvePublicTenantForHoldKey('only-a', 'test'))?.tenantId).toBe(A);
    expect(await resolvePublicTenantForHoldKey('shared', 'test')).toBeNull();
    expect(await resolvePublicTenantForHoldKey('forged', 'test')).toBeNull();
    expect(await resolvePublicTenantForHoldKey('missing', 'test')).toBeNull();
  });

  it('hold release accepts the server-returned prefixed key, but only for the tenant it names', async () => {
    expect((await resolvePublicTenantForHoldKey(`t:${up(A)}:only-a`, 'test'))?.tenantId).toBe(A);
    expect((await resolvePublicTenantForHoldKey(`t:${B}:shared`, 'test'))?.tenantId).toBe(B);
    expect((await resolvePublicTenantForHoldKey(`t:${A}:shared`, 'test'))?.tenantId).toBe(A);
    expect(await resolvePublicTenantForHoldKey(`t:${B}:only-a`, 'test')).toBeNull();
    expect(await resolvePublicTenantForHoldKey(`t:${B}:forged`, 'test')).toBeNull();
  });
});

describe('DRVO-013 caches and memoization cannot leak across tenants', () => {
  it('identical local keys are distinct entries per tenant', async () => {
    const memo = new TenantScopedMemo<string>('branch-config', 60_000);
    memo.set(A, ['branch', '1'], 'value-A');
    expect(memo.get(B, ['branch', '1'])).toBeUndefined();
    const loadB = vi.fn(async () => 'value-B');
    expect(await memo.getOrLoad(B, ['branch', '1'], loadB)).toBe('value-B');
    expect(loadB).toHaveBeenCalledTimes(1);
    expect(memo.get(A, ['branch', '1'])).toBe('value-A');
  });

  it('upper/lower-case tenant ids address the same entry; invalidation is per tenant', () => {
    const memo = new TenantScopedMemo<number>('m', 60_000);
    memo.set(up(A), [], 1);
    memo.set(B, [], 2);
    expect(memo.get(A, [])).toBe(1);
    memo.invalidateTenant(up(A));
    expect(memo.get(A, [])).toBeUndefined();
    expect(memo.get(B, [])).toBe(2);
  });

  it('a memo cannot be addressed without an authoritative tenant', () => {
    const memo = new TenantScopedMemo<number>('m', 60_000);
    expect(() => memo.get('', [])).toThrow(/authoritative tenantId/);
    expect(() => memo.set('CASHER_BOOT', [], 1)).toThrow(/authoritative tenantId/);
  });

  it('cache keys are tenant-prefixed and case-normalized', () => {
    expect(tenantCacheKey(up(A), 'catalog', ['1'])).toBe(tenantCacheKey(A, 'catalog', ['1']));
    expect(tenantCacheKey(A, 'catalog', ['1'])).not.toBe(tenantCacheKey(B, 'catalog', ['1']));
    expect(() => tenantCacheKey('', 'catalog')).toThrow();
  });
});

describe('DRVO-013 idempotency keys do not collide across tenants', () => {
  it('the same client key maps to distinct stored keys per tenant', () => {
    const a = namespacedRequestKey(A, 'client-key-1');
    const b = namespacedRequestKey(B, 'client-key-1');
    expect(a).toBe(`t:${A}:client-key-1`);
    expect(b).toBe(`t:${B}:client-key-1`);
    expect(namespacedRequestKey(up(A), 'client-key-1')).toBe(a);
  });

  it('re-namespacing is idempotent; another tenant prefix is treated as opaque client data', () => {
    const a = namespacedRequestKey(A, 'k')!;
    expect(namespacedRequestKey(A, a)).toBe(a);
    expect(namespacedRequestKey(B, a)).toBe(`t:${B}:${a}`);
  });

  it('long keys are hashed (never truncated) and stay tenant-distinct within 128 chars', () => {
    const long = 'x'.repeat(200);
    const a = namespacedRequestKey(A, long)!;
    const b = namespacedRequestKey(B, long)!;
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a.startsWith(`t:${A}:h:`)).toBe(true);
    expect(a).not.toBe(b);
    expect(namespacedRequestKey(A, long + 'y')).not.toBe(a);
    expect(namespacedRequestKey(A, `t:${A}:${long}`)).toBe(a);
    expect(namespacedRequestKey(A, a)).toBe(a);
  });

  it('empty client keys pass through; a missing tenant is rejected', () => {
    expect(namespacedRequestKey(A, undefined)).toBeUndefined();
    expect(namespacedRequestKey(A, null)).toBeNull();
    expect(() => namespacedRequestKey('', 'k')).toThrow(/authoritative tenantId/);
  });

  it('hold keys and platform idempotency keys are tenant-namespaced', () => {
    expect(namespacedHoldKey(A, 'h1')).not.toBe(namespacedHoldKey(B, 'h1'));
    expect(namespacedHoldKey(up(A), namespacedHoldKey(A, 'h1'))).toBe(`t:${A}:h1`);
    expect(() => namespacedHoldKey('', 'h1')).toThrow();
    expect(tenantIdempotencyKey(A, 'treasury', 'k')).not.toBe(tenantIdempotencyKey(B, 'treasury', 'k'));
    expect(() => tenantIdempotencyKey('not-a-uuid', 'treasury', 'k')).toThrow();
  });
});

describe('DRVO-013 applocks are tenant-scoped', () => {
  it('the same resource parts produce different lock names per tenant', () => {
    expect(tenantLockResource(A, ['booking', 'slot', '1'])).not.toBe(tenantLockResource(B, ['booking', 'slot', '1']));
  });

  it('lock names are case-normalized (sp_getapplock is case-sensitive)', () => {
    expect(tenantLockResource(up(A), ['treasury', '1'])).toBe(`t:${A}:treasury:1`);
  });

  it('a lock cannot be taken without a tenant', () => {
    expect(() => tenantLockResource('', ['x'])).toThrow();
    expect(() => tenantLockResource(A, [])).toThrow();
  });
});

describe('DRVO-013 workers preserve TenantId (PlatformOutbox consumer)', () => {
  it('a tenant-scoped claim never returns another tenant’s rows', async () => {
    db.outbox = [outboxRow(1, A), outboxRow(2, B), outboxRow(3, A)];
    const rows = await claimPlatformOutboxBatch({ batchSize: 10, tenantId: B });
    expect(rows.map((r) => r.id)).toEqual([2]);
    expect(rows[0].tenantId).toBe(B);
    expect(db.outbox.filter((r) => r.Status === 'pending').map((r) => r.Id)).toEqual([1, 3]);
  });

  it('each handler call receives the TenantId of its own row; settle is keyed by (Id, TenantId)', async () => {
    db.outbox = [outboxRow(1, up(A)), outboxRow(2, up(B))];
    const seen: Array<{ id: number; tenant: string; kind: string }> = [];
    const summary = await processPlatformOutboxTick(
      async ({ row, tenant }) => {
        seen.push({ id: row.id, tenant: tenant.tenantId, kind: tenant.kind });
      },
      { batchSize: 10 },
    );
    expect(seen).toEqual([
      { id: 1, tenant: A, kind: 'job' },
      { id: 2, tenant: B, kind: 'job' },
    ]);
    expect(summary).toMatchObject({ claimed: 2, delivered: 2, retried: 0, dead: 0, rejected: 0 });
    expect(db.settles).toEqual([
      { id: 1, tenantId: A, status: 'delivered' },
      { id: 2, tenantId: B, status: 'delivered' },
    ]);
    expect(db.outbox.map((r) => r.Status)).toEqual(['delivered', 'delivered']);
  });

  it('a row without a valid TenantId is dead-lettered and never dispatched', async () => {
    db.outbox = [outboxRow(1, 'CASHER_BOOT')];
    const handler = vi.fn(async () => undefined);
    const summary = await processPlatformOutboxTick(handler, { batchSize: 10 });
    expect(handler).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ rejected: 1, delivered: 0 });
    expect(db.outbox[0].Status).toBe('dead');
  });

  it('handler failures retry until max attempts, then dead-letter', async () => {
    db.outbox = [outboxRow(1, A), outboxRow(2, B, { Attempts: 2 })];
    const summary = await processPlatformOutboxTick(
      async () => {
        throw new Error('boom');
      },
      { batchSize: 10, maxAttempts: 3 },
    );
    expect(summary).toMatchObject({ retried: 1, dead: 1 });
    expect(db.outbox.map((r) => [r.Status, r.Attempts])).toEqual([
      ['pending', 1],
      ['dead', 3],
    ]);
  });

  it('job contexts require a real TenantId; actors without one are rejected', () => {
    expect(buildJobTenantContext(up(A), 'w')).toEqual({ kind: 'job', tenantId: A, source: 'w' });
    expect(() => buildJobTenantContext(null, 'w')).toThrow(TenantContextError);
    expect(() => buildJobTenantContext('', 'w')).toThrow(TenantContextError);
    expect(() => requireActorTenantId({ tenantId: null }, 'x')).toThrow(TenantContextError);
    expect(requireActorTenantId({ tenantId: A }, 'x')).toBe(A);
  });
});

describe('DRVO-013 DRVO-012 commercial/app gates resolve through the authoritative tenant', () => {
  it('app entitlement is evaluated per tenant and never shared through the memo', async () => {
    apps.installed = { [A]: ['booking', 'pos'], [B]: ['pos'] };
    await expect(assertTenantAppInstalled(A, 'booking')).resolves.toBeUndefined();
    await expect(assertTenantAppInstalled(B, 'booking')).rejects.toMatchObject({
      code: 'APP_NOT_INSTALLED',
      status: 403,
    });
    await expect(assertTenantAppInstalled(B, 'pos')).resolves.toBeUndefined();
    expect(apps.loads).toEqual([A, B]);
  });

  it('subscription state is per tenant; invalidating one tenant does not touch the other', async () => {
    subs.active = { [A]: true, [B]: false };
    await expect(assertTenantSubscriptionActive(A)).resolves.toMatchObject({ allowed: true });
    const denied = await assertTenantSubscriptionActive(B).catch((e) => e);
    expect(denied).toBeInstanceOf(TenantAccessDeniedError);
    expect(denied).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE', reason: 'NO_SUBSCRIPTION' });

    subs.active[B] = true;
    invalidateTenantAccessGate(B);
    await expect(assertTenantSubscriptionActive(B)).resolves.toMatchObject({ allowed: true });
    await expect(assertTenantSubscriptionActive(A)).resolves.toMatchObject({ allowed: true });
    expect(subs.loads).toEqual([A, B, B]);
  });

  it('gates refuse a non-authoritative tenant id', async () => {
    await expect(assertTenantAppInstalled('', 'booking')).rejects.toThrow(/authoritative tenantId/);
    await expect(assertTenantSubscriptionActive('CASHER_BOOT')).rejects.toThrow(/authoritative tenantId/);
  });
});

describe('DRVO-013 CASHER_BOOT seams', () => {
  it('only named seams may resolve the bootstrap tenant', async () => {
    await expectTenantError(
      resolveLegacyBootstrapTenantId('request-default' as never),
      'TENANT_CONTEXT_UNRESOLVED',
    );
  });
});
