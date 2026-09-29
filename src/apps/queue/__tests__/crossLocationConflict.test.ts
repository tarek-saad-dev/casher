import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';
import { bridgeQueueAssertEmployeeFree } from '@/lib/queue/queuePortLegacyBridge';
import { createQueuePortHooks } from '../internal/queuePortAdapter';
import { createLegacyWorkforceOccupancyAdapter } from '@/shared/workforce/public';
import type { QueueSchedulingPorts } from '../public/ports';
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
    excludeQueueTicketId?: number;
    excludeBookingId?: number;
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
    if (args.excludeQueueTicketId === 55) return;
    const start = args.startAt.getTime();
    const end = args.endAt.getTime();
    if (start < BUSY_END && end > BUSY_START) {
      throw new Error('CROSS_LOCATION_CONFLICT');
    }
  },
}));

function hooksForTenant() {
  const actor: QueueSchedulingPorts['actor'] = {
    actorType: 'staff',
    actorId: '1',
    tenantId: TENANT,
    membershipId: null,
    viewLocationId: null,
  };
  return createQueuePortHooks({
    tenantId: TENANT,
    actor,
    customers: {} as QueueSchedulingPorts['customers'],
    catalog: {} as QueueSchedulingPorts['catalog'],
    occupancy: createLegacyWorkforceOccupancyAdapter(TENANT),
    calendar: {} as QueueSchedulingPorts['calendar'],
    publishOutbox: async () => 1,
  });
}

const tx = {} as Transaction;

describe('cross-location employee conflict via Workforce occupancy port (queue)', () => {
  it('fails closed for another location and forwards date and branch', async () => {
    assertCalls.length = 0;
    lockResources.length = 0;
    const hooks = hooksForTenant();

    await expect(
      bridgeQueueAssertEmployeeFree(
        { queuePortHooks: hooks },
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
    expect(assertCalls[0].branchId).toBe(2);
    expect(assertCalls[0].operationalDate).toBe('2026-09-28');

    const empLock = empIntervalLockResource(9, BUSY_START, BUSY_END);
    const tenantLock = tenantLockResource(TENANT, ['emp', '9', String(BUSY_START), String(BUSY_END)]);
    expect(lockResources).toContain(empLock);
    expect(lockResources).toContain(tenantLock);
  });

  it('passes when excludeQueueTicketId matches own ticket', async () => {
    assertCalls.length = 0;
    const hooks = hooksForTenant();

    await bridgeQueueAssertEmployeeFree(
      { queuePortHooks: hooks },
      tx,
      {
        employeeId: 9,
        startMs: BUSY_START,
        endMs: BUSY_END,
        operationalDate: '2026-09-28',
        branchId: 2,
        excludeQueueTicketId: 55,
      },
    );

    expect(assertCalls[0].excludeQueueTicketId).toBe(55);
  });
});
