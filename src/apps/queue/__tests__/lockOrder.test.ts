import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';
import { bridgeQueueAssertEmployeeFree } from '@/lib/queue/queuePortLegacyBridge';
import { createQueuePortHooks } from '../internal/queuePortAdapter';
import { createLegacyWorkforceOccupancyAdapter } from '@/shared/workforce/public';

const TENANT = '11111111-1111-4111-8111-111111111111';
const START_MS = Date.parse('2026-09-28T10:00:00+03:00');
const END_MS = Date.parse('2026-09-28T10:30:00+03:00');

const { lockOrder } = vi.hoisted(() => ({
  lockOrder: [] as string[],
}));

vi.mock('@/lib/db', () => {
  class Request {
    private resource = '';
    input(name: string, _type: unknown, value?: unknown) {
      if (name === 'resource') this.resource = String(value);
      return this;
    }
    async query(text: string) {
      if (String(text).includes('sp_getapplock')) lockOrder.push(this.resource);
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
  ScheduleConflictError: class ScheduleConflictError extends Error {},
  assertEmployeeIntervalAvailable: async () => {
    lockOrder.push('operations-schedule');
  },
}));

describe('DRVO-005 queue lock order', () => {
  it('port path takes booking:emp before operations-schedule (same order as Booking/Workforce)', async () => {
    lockOrder.length = 0;
    const hooks = createQueuePortHooks({
      tenantId: TENANT,
      actor: {
        actorType: 'staff',
        actorId: '1',
        tenantId: TENANT,
        membershipId: null,
        viewLocationId: null,
      },
      customers: {} as never,
      catalog: {} as never,
      occupancy: createLegacyWorkforceOccupancyAdapter(TENANT),
      calendar: {} as never,
      publishOutbox: async () => 1,
    });

    await bridgeQueueAssertEmployeeFree(
      { queuePortHooks: hooks },
      {} as Transaction,
      {
        employeeId: 5,
        startMs: START_MS,
        endMs: END_MS,
        operationalDate: '2026-09-28',
        branchId: 1,
      },
    );

    const intervalAt = lockOrder.findIndex((r) => r.startsWith('booking:emp:5:'));
    const tenantAt = lockOrder.findIndex((r) => r.startsWith(`t:${TENANT}:emp:5:`));
    const scheduleAt = lockOrder.indexOf('operations-schedule');
    expect(intervalAt).toBeGreaterThanOrEqual(0);
    expect(tenantAt).toBeGreaterThan(intervalAt);
    expect(scheduleAt).toBeGreaterThan(tenantAt);
  });

  it('flag-off legacy path does not take booking:emp', async () => {
    lockOrder.length = 0;
    await bridgeQueueAssertEmployeeFree({}, {} as Transaction, {
      employeeId: 5,
      startMs: START_MS,
      endMs: END_MS,
      operationalDate: '2026-09-28',
      branchId: 1,
    });
    expect(lockOrder).toEqual(['operations-schedule']);
    expect(lockOrder.some((r) => r.startsWith('booking:emp:'))).toBe(false);
  });
});
