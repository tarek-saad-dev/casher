/** DRVO-013 SQL-boundary regression for tenant-scoped booking contact reads (fake DB, no PII). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const fake = vi.hoisted(() => ({
  bookings: new Map<number, {
    bookingId: number; clientId: number | null; branchId: number | null;
    clientMobile: string; bookingCode: string;
  }>(),
  locations: new Map<number, { tenantId: string; active: boolean }>(),
  queries: [] as Array<{ sql: string; inputs: Record<string, unknown> }>,
}));

vi.mock('@/lib/db', () => {
  const pool = {
    request() {
      const inputs: Record<string, unknown> = {};
      const request = {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return request;
        },
        async query(query: string) {
          fake.queries.push({ sql: query, inputs: { ...inputs } });
          if (query.includes('FROM dbo.Bookings b')) {
            const booking = fake.bookings.get(Number(inputs.id));
            if (!booking) return { recordset: [] };
            const scoped = query.includes('INNER JOIN dbo.Location scopeLocation');
            if (scoped) {
              const loc = fake.locations.get(booking.branchId ?? -1);
              if (!loc || !loc.active || loc.tenantId.toLowerCase() !== String(inputs.tenantId).toLowerCase()) {
                return { recordset: [] };
              }
            }
            return {
              recordset: [{
                BookingID: booking.bookingId,
                BookingCode: booking.bookingCode,
                ClientID: booking.clientId,
                AssignedEmpID: 7,
                BranchID: booking.branchId,
                ClientName: 'synthetic customer',
                ClientMobile: booking.clientMobile,
                EmpName: 'synthetic employee',
                BranchName: 'synthetic branch',
                BookingDate: '2026-11-22',
                StartTime: '10:00',
                ServicesSummary: 'synthetic service',
              }],
            };
          }
          if (query.includes('COL_LENGTH')) return { recordset: [{ Len: 0 }] };
          throw new Error(`Unexpected SQL: ${query.slice(0, 100)}`);
        },
      };
      return request;
    },
  };
  return {
    getPool: vi.fn(async () => pool),
    sql: { Int: 'Int', UniqueIdentifier: 'UniqueIdentifier' },
  };
});

vi.mock('@/lib/publicBookingHelpers', () => ({
  normalizePublicBookingPhone: (phone: string) => String(phone ?? '').replace(/\\D/g, ''),
  isUsableCustomerPhone: (phone: string) => /^201\\d{9}$/.test(phone),
}));

import {
  loadBookingCustomerContact,
  loadBookingCustomerContactForTenant,
} from '@/lib/booking/bookingCustomerContact';

beforeEach(() => {
  fake.bookings.clear();
  fake.locations.clear();
  fake.queries = [];
  fake.bookings.set(101, { bookingId: 101, clientId: 11, branchId: 1, bookingCode: 'BK-A', clientMobile: '201000000001' });
  fake.bookings.set(202, { bookingId: 202, clientId: 22, branchId: 2, bookingCode: 'BK-B', clientMobile: '201000000002' });
  fake.locations.set(1, { tenantId: A, active: true });
  fake.locations.set(2, { tenantId: B, active: true });
});

describe('DRVO-013 tenant-scoped booking contact SQL read', () => {
  it('only materializes a booking contact when the active Location belongs to the claimed tenant', async () => {
    const contactA = await loadBookingCustomerContactForTenant(101, A);
    expect(contactA).toMatchObject({ bookingId: 101, branchId: 1, phone: '201000000001' });
    const read = fake.queries.find((q) => q.sql.includes('FROM dbo.Bookings b'));
    expect(read?.inputs.tenantId).toBe(A);
    expect(read?.sql).toContain('INNER JOIN dbo.Location scopeLocation');
    expect(read?.sql).toContain('scopeLocation.TenantId = @tenantId');
    expect(read?.sql).toContain("scopeLocation.Status = N'active'");
    expect(read?.sql).toContain("scopeTenant.Status = N'active'");
  });

  it('does not even read the phone fallback for a foreign booking', async () => {
    expect(await loadBookingCustomerContactForTenant(202, A)).toBeNull();
    expect(fake.queries).toHaveLength(1);
    expect(fake.queries[0].inputs).toMatchObject({ id: 202, tenantId: A });
  });

  it('separates two tenants with their own synthetic booking contacts', async () => {
    expect((await loadBookingCustomerContactForTenant(101, A))?.phone).toBe('201000000001');
    expect((await loadBookingCustomerContactForTenant(202, B))?.phone).toBe('201000000002');
    expect(await loadBookingCustomerContactForTenant(101, B)).toBeNull();
  });

  it('rejects an inactive or missing Location before reading the customer phone', async () => {
    fake.locations.set(1, { tenantId: A, active: false });
    expect(await loadBookingCustomerContactForTenant(101, A)).toBeNull();
    expect(fake.queries).toHaveLength(1);
    fake.queries = [];
    fake.locations.delete(1);
    expect(await loadBookingCustomerContactForTenant(101, A)).toBeNull();
    expect(fake.queries).toHaveLength(1);
  });

  it('rejects invalid worker tenant identity before opening SQL', async () => {
    await expect(loadBookingCustomerContactForTenant(101, '')).rejects.toThrow('BOOKING_CONTACT_TENANT_REQUIRED');
    await expect(loadBookingCustomerContactForTenant(101, 'CASHER_BOOT')).rejects.toThrow('BOOKING_CONTACT_TENANT_REQUIRED');
    expect(fake.queries).toEqual([]);
  });

  it('preserves explicit legacy read behavior for existing unrelated callers', async () => {
    const contact = await loadBookingCustomerContact(101);
    expect(contact).toMatchObject({ bookingId: 101, branchId: 1 });
    const read = fake.queries.find((q) => q.sql.includes('FROM dbo.Bookings b'));
    expect(read?.sql).not.toContain('INNER JOIN dbo.Location scopeLocation');
    expect(read?.inputs).not.toHaveProperty('tenantId');
  });
});
