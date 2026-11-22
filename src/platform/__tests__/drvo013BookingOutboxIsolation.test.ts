/**
 * DRVO-013 P0 — legacy booking outbox dispatcher must not send a booking contact
 * from Tenant B when the claimed PlatformOutbox row belongs to Tenant A.
 * This is synthetic/fake-DB regression; real two-tenant staging remains a separate gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type FakeRow = {
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

const state = vi.hoisted(() => ({
  rows: [] as FakeRow[],
  contacts: new Map<number, { branchId: number | null; phone: string | null; bookingCode: string }>(),
  locationTenants: new Map<number, string>(),
  sends: [] as Array<Record<string, unknown>>,
  scopes: [] as Array<{ tenantId: string; source: string; detail: string }>,
  validated: [] as Array<{ tenantId: string; branchId: number }>,
}));

vi.mock('@/lib/db', () => {
  class Request {
    private readonly params: Record<string, unknown> = {};
    input(name: string, _type: unknown, value?: unknown) {
      this.params[name] = value;
      return this;
    }
    async query(query: string) {
      if (query.includes(';WITH claim AS')) {
        const pending = state.rows
          .filter((r) => r.Status === 'pending' && r.Attempts < 5)
          .slice(0, Number(this.params.batchSize));
        for (const row of pending) {
          row.Status = 'delivering';
          row.Attempts += 1;
        }
        return { recordset: pending.map((row) => ({ ...row })) };
      }
      if (query.includes("SET Status = N'delivered'")) {
        const r = state.rows.find((row) => row.Id === this.params.id && row.Status === 'delivering');
        if (r) r.Status = 'delivered';
        return { recordset: [] };
      }
      if (query.includes('SET Status = @status')) {
        const r = state.rows.find((row) => row.Id === this.params.id && row.Status === 'delivering');
        if (r) r.Status = String(this.params.status) as FakeRow['Status'];
        return { recordset: [] };
      }
      throw new Error(`Unexpected SQL in fake outbox: ${query.slice(0, 100)}`);
    }
  }
  class Transaction {
    constructor(_pool: unknown) {}
    async begin() {}
    async commit() {}
    async rollback() {}
  }
  const NVarChar = (_n: number) => 'NVarChar';
  return {
    sql: { Transaction, Request, Int: 'Int', BigInt: 'BigInt', DateTime2: 'DateTime2', NVarChar },
    getPool: vi.fn(async () => ({ request: () => new Request() })),
  };
});

vi.mock('@/lib/booking/bookingCustomerContact', () => ({
  loadBookingCustomerContact: vi.fn(async (id: number) => {
    const contact = state.contacts.get(id);
    if (!contact) return null;
    return {
      bookingId: id,
      bookingCode: contact.bookingCode,
      customerName: 'synthetic customer',
      phone: contact.phone,
      bookingDate: '2026-11-22',
      startTime: '10:00',
      servicesSummary: 'synthetic service',
      empName: 'synthetic barber',
      branchName: 'synthetic branch',
      branchId: contact.branchId,
    };
  }),
}));

vi.mock('@/platform/tenant/tenantContext', () => ({
  assertLegacyBranchInTenant: vi.fn(async (tenantId: string, branchId: number) => {
    state.validated.push({ tenantId, branchId });
    if (state.locationTenants.get(branchId)?.toLowerCase() !== tenantId.toLowerCase()) {
      throw new Error('LOCATION_NOT_IN_TENANT');
    }
    return { legacyBranchId: branchId };
  }),
}));

vi.mock('@/modules/messaging/tenancy/messagingTenantScope', () => ({
  runWithMessagingTenant: async (
    scope: { tenantId: string; source: string; detail: string },
    fn: () => Promise<unknown>,
  ) => {
    state.scopes.push(scope);
    return fn();
  },
}));

vi.mock('@/modules/messaging/application/composeMessage', () => ({
  composeMessage: vi.fn(async () => ({ text: 'safe synthetic notification', source: 'test' })),
}));

vi.mock('@/modules/messaging/tenancy/transport', () => ({
  sendViaTenantChannel: vi.fn(async (input: Record<string, unknown>) => {
    state.sends.push(input);
    return { sent: true };
  }),
}));

vi.mock('@/platform/outbox/staffBookingPushNotify', () => ({
  notifyStaffOfOutboxBookingCreated: vi.fn(async () => ({ scheduled: false })),
}));

import { processPlatformOutboxTick } from '@/platform/outbox/processor';

function event(id: number, tenantId: string, bookingId: number): FakeRow {
  return {
    Id: id,
    TenantId: tenantId,
    AggregateType: 'booking',
    AggregateId: String(bookingId),
    EventType: 'booking.cancelled',
    Payload: '{}',
    IdempotencyKey: null,
    CorrelationId: null,
    OccurredAt: new Date('2026-11-22T12:00:00Z'),
    Status: 'pending',
    Attempts: 0,
  };
}

beforeEach(() => {
  state.rows = [];
  state.contacts.clear();
  state.locationTenants.clear();
  state.sends = [];
  state.scopes = [];
  state.validated = [];
  state.locationTenants.set(11, A);
  state.locationTenants.set(22, B);
});

describe('DRVO-013 legacy booking outbox contact/tenant ownership', () => {
  it('denies a foreign booking aggregate before composing/sending WhatsApp', async () => {
    state.rows = [event(1, A, 202)];
    state.contacts.set(202, { branchId: 22, phone: '201000000002', bookingCode: 'BK-B' });
    const result = await processPlatformOutboxTick({ batchSize: 10 });
    expect(result).toMatchObject({ claimed: 1, delivered: 0, retried: 1 });
    expect(state.validated).toEqual([{ tenantId: A, branchId: 22 }]);
    expect(state.sends).toEqual([]);
    expect(state.rows[0].Status).toBe('pending');
  });

  it('continues delivering correctly scoped bookings independently for two tenants', async () => {
    state.rows = [event(1, A, 101), event(2, B, 202)];
    state.contacts.set(101, { branchId: 11, phone: '201000000001', bookingCode: 'BK-A' });
    state.contacts.set(202, { branchId: 22, phone: '201000000002', bookingCode: 'BK-B' });
    const result = await processPlatformOutboxTick({ batchSize: 10 });
    expect(result).toMatchObject({ claimed: 2, delivered: 2, retried: 0 });
    expect(state.validated).toEqual([
      { tenantId: A, branchId: 11 },
      { tenantId: B, branchId: 22 },
    ]);
    expect(state.scopes.map((scope) => scope.tenantId)).toEqual([A, B]);
    expect(state.sends).toHaveLength(2);
    expect(state.rows.map((r) => r.Status)).toEqual(['delivered', 'delivered']);
  });

  it('fails closed when a legacy booking has no BranchID', async () => {
    state.rows = [event(3, A, 303)];
    state.contacts.set(303, { branchId: null, phone: '201000000003', bookingCode: 'BK-NO-BRANCH' });
    const result = await processPlatformOutboxTick({ batchSize: 1 });
    expect(result).toMatchObject({ claimed: 1, delivered: 0, retried: 1 });
    expect(state.validated).toEqual([]);
    expect(state.sends).toEqual([]);
  });

  it('fails closed for unmapped/inactive tenant locations', async () => {
    state.rows = [event(4, A, 404)];
    state.contacts.set(404, { branchId: 99, phone: '201000000004', bookingCode: 'BK-INACTIVE' });
    const result = await processPlatformOutboxTick({ batchSize: 1 });
    expect(result.delivered).toBe(0);
    expect(result.retried).toBe(1);
    expect(state.sends).toEqual([]);
  });
});
