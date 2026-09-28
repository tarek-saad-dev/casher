import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';
import { bridgeAssertEmployeeFree } from '@/lib/booking/schedulingPortLegacyBridge';
import { createSchedulingPortHooks } from '../internal/schedulingPortAdapter';
import { createLegacyWorkforceOccupancyAdapter } from '@/shared/workforce/public';
import type { BookingSchedulingPorts } from '../public/ports';
import { empIntervalLockResource } from '@/lib/booking/publicBookingCreateLocks';
import { tenantLockResource } from '@/platform/public';

const TENANT = '11111111-1111-4111-8111-111111111111';
const BUSY_START = Date.parse('2026-09-28T10:00:00+03:00');
const BUSY_END = Date.parse('2026-09-28T11:00:00+03:00');

const { assertCalls, lockResources } = vi.hoisted(() => ({
  assertCalls: [] as Array<{
    empId: number;
    startAt: Date;
    endAt: Date;
    operationalDate?: string;
    branchId?: number | null;
    excludeBookingId?: number;
    excludeHoldKey?: string | null;
  }>,
  lockResources: [] as string[],
}));

vi.mock('@/lib/db', () => {
  class Request {
    private resource = '';
    input(name: string, _type: unknown, value?: unknown) {
      if (name === 'resource') this.resource = String(value);
      return this;
    }
    async query(text: string) {
      if (String(text).includes('sp_getapplock')) lockResources.push(this.resource);
      return { recordset: [{ lockResult: 0 }] };
    }
  }
  return {
    sql: {
      NVarChar: (n: number) => ({ n }),
      Int: { type: 'int' },
      Request,
    },
  };
});

vi.mock('@/lib/scheduleIntegrity', () => ({
  ScheduleConflictError: class ScheduleConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ScheduleConflictError';
    }
  },
  assertEmployeeIntervalAvailable: async (args: (typeof assertCalls)[number]) => {
    assertCalls.push(args);
    if (args.empId !== 9) return;
    if (args.operationalDate !== '2026-09-28') return;
    if (args.excludeBookingId === 42) return;
    if (args.excludeHoldKey === 'own-hold') return;
    const start = args.startAt.getTime();
    const end = args.endAt.getTime();
    if (start < BUSY_END && end > BUSY_START) {
      throw new Error('CROSS_LOCATION_CONFLICT');
    }
  },
}));

function hooksForTenant() {
  const actor: BookingSchedulingPorts['actor'] = {
    actorType: 'customer',
    actorId: 'anonymous',
    tenantId: TENANT,
    membershipId: null,
    viewLocationId: null,
  };
  return createSchedulingPortHooks({
    tenantId: TENANT,
    actor,
    customers: {} as BookingSchedulingPorts['customers'],
    catalog: {} as BookingSchedulingPorts['catalog'],
    occupancy: createLegacyWorkforceOccupancyAdapter(TENANT),
    calendar: {} as BookingSchedulingPorts['calendar'],
    conversion: {} as BookingSchedulingPorts['conversion'],
    publishOutbox: async () => 1,
  });
}

const tx = {} as Transaction;

describe('cross-location employee conflict via Workforce occupancy port', () => {
  it('fails closed for another location and forwards date, branch, and exclusions', async () => {
    assertCalls.length = 0;
    lockResources.length = 0;
    const hooks = hooksForTenant();

    await expect(
      bridgeAssertEmployeeFree(
        { schedulingPortHooks: hooks },
        tx,
        {
          employeeId: 9,
          startMs: BUSY_START,
          endMs: BUSY_END,
          operationalDate: '2026-09-28',
          branchId: 2,
        },
      ),
    ).rejects.toThrow('CROSS_LOCATION_CONFLICT');

    expect(assertCalls).toHaveLength(1);
    const call = assertCalls[0];
    expect(call.startAt).toBeInstanceOf(Date);
    expect(call.endAt).toBeInstanceOf(Date);
    expect(call.startAt.getTime()).toBe(BUSY_START);
    expect(call.endAt.getTime()).toBe(BUSY_END);
    expect(call.operationalDate).toBe('2026-09-28');
    expect(call.branchId).toBe(2);
    expect(call.excludeBookingId).toBeUndefined();
    expect(call.excludeHoldKey).toBeNull();

    const legacy = empIntervalLockResource(9, BUSY_START, BUSY_END);
    const tenant = tenantLockResource(TENANT, ['emp', '9', String(BUSY_START), String(BUSY_END)]);
    expect(lockResources).toContain(legacy);
    expect(lockResources).toContain(tenant);
  });

  it('does not treat the booking being moved as a conflict', async () => {
    assertCalls.length = 0;
    const hooks = hooksForTenant();
    await expect(
      bridgeAssertEmployeeFree(
        { schedulingPortHooks: hooks },
        tx,
        {
          employeeId: 9,
          startMs: BUSY_START,
          endMs: BUSY_END,
          operationalDate: '2026-09-28',
          branchId: 2,
          excludeBookingId: 42,
        },
      ),
    ).resolves.toBeUndefined();
    expect(assertCalls.at(-1)?.excludeBookingId).toBe(42);
  });

  it('does not treat the customer hold as a conflict', async () => {
    assertCalls.length = 0;
    const hooks = hooksForTenant();
    await expect(
      bridgeAssertEmployeeFree(
        { schedulingPortHooks: hooks },
        tx,
        {
          employeeId: 9,
          startMs: BUSY_START,
          endMs: BUSY_END,
          operationalDate: '2026-09-28',
          branchId: 1,
          excludeHoldKey: 'own-hold',
        },
      ),
    ).resolves.toBeUndefined();
    expect(assertCalls.at(-1)?.excludeHoldKey).toBe('own-hold');
  });
});
