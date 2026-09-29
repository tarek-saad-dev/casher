import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchDomainError } from '@/lib/branch/types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const staffActor = {
  actorType: 'staff' as const,
  actorId: '7',
  tenantId: TENANT,
  membershipId: null,
  viewLocationId: null,
};

const { publishedKeys, countQueue, publishImpl } = vi.hoisted(() => {
  const publishedKeys: string[] = [];
  const countQueue: number[] = [];
  const publishImpl = vi.fn(async (_tx: unknown, event: { idempotencyKey?: string }) => {
    publishedKeys.push(String(event.idempotencyKey));
    return 1;
  });
  return { publishedKeys, countQueue, publishImpl };
});

vi.mock('@/platform/public', () => ({
  publishPlatformOutboxEvent: (...args: unknown[]) =>
    publishImpl(...(args as [unknown, { idempotencyKey?: string }])),
}));

vi.mock('@/lib/db', () => {
  class Request {
    private values = new Map<string, unknown>();
    input(name: string, _type: unknown, value: unknown) {
      this.values.set(name, value);
      return this;
    }
    async query(text: string) {
      if (String(text).includes('COUNT(*)')) {
        return { recordset: [{ cnt: countQueue.shift() ?? 0 }] };
      }
      return { recordset: [] };
    }
  }
  const NVarChar = Object.assign((n: number) => ({ n }), { MAX: -1 });
  return {
    sql: {
      Request,
      Int: { type: 'int' },
      UniqueIdentifier: { type: 'uid' },
      NVarChar,
      DateTime2: { type: 'datetime2' },
    },
    getPool: vi.fn(),
  };
});

vi.mock('@/lib/branch/repository', () => ({
  getBranchById: vi.fn(async (id: number) => ({
    branchId: id,
    isActive: true,
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00:00',
  })),
}));

vi.mock('@/lib/branch/access', () => ({
  validateUserBranchAccess: vi.fn(async () => ({ canOperate: true })),
}));

vi.mock('@/modules/operations/clock/BusinessClock', () => ({
  resolveBusinessDate: () => '2026-09-29',
}));

vi.mock('@/modules/operations/infra/businessDayLock', () => ({
  lockBranchForDayMutation: vi.fn(async () => undefined),
}));

const openBusinessDayInTransaction = vi.fn(async () => ({
  id: 5,
  branchId: 1,
  newDay: '2026-09-29',
  status: true,
}));

vi.mock('@/modules/operations/infra/businessDayMutationTx', () => ({
  openBusinessDayInTransaction: (...args: unknown[]) => openBusinessDayInTransaction(...args),
  closeBusinessDayInTransaction: vi.fn(),
}));

vi.mock('@/modules/operations/infra/shiftMutationTx', () => ({
  openOrHandoffShiftInTransaction: vi.fn(),
  closeShiftInTransaction: vi.fn(),
}));

describe('calendar day outbox keys', () => {
  beforeEach(() => {
    publishedKeys.length = 0;
    countQueue.length = 0;
    publishImpl.mockClear();
    publishImpl.mockImplementation(async (_tx: unknown, event: { idempotencyKey?: string }) => {
      publishedKeys.push(String(event.idempotencyKey));
      return 1;
    });
    openBusinessDayInTransaction.mockReset();
    openBusinessDayInTransaction.mockResolvedValue({
      id: 5,
      branchId: 1,
      newDay: '2026-09-29',
      status: true,
    });
  });

  it('uses a new occurrence when the same TblNewDay id is opened again', async () => {
    countQueue.push(0, 1);
    const { openDayInTransaction } = await import('../internal/calendarMutations');
    const tx = {} as never;
    await openDayInTransaction(tx, TENANT, staffActor, { locationId: 1, businessDate: '2026-09-29' });
    await openDayInTransaction(tx, TENANT, staffActor, { locationId: 1, businessDate: '2026-09-29' });
    expect(publishedKeys).toEqual([
      'calendar.day.opened:1:5:1',
      'calendar.day.opened:1:5:2',
    ]);
  });

  it('does not publish when the day is already open', async () => {
    openBusinessDayInTransaction.mockRejectedValueOnce(
      new BranchDomainError('ALREADY_OPEN_BUSINESS_DAY', 'open', 400),
    );
    const { openDayInTransaction } = await import('../internal/calendarMutations');
    await expect(
      openDayInTransaction({} as never, TENANT, staffActor, { locationId: 1 }),
    ).rejects.toMatchObject({ code: 'ALREADY_OPEN_BUSINESS_DAY' });
    expect(publishedKeys).toEqual([]);
  });

  it('maps an outbox unique-key failure to the stable day domain error', async () => {
    publishImpl.mockRejectedValueOnce(
      Object.assign(new Error('Cannot insert duplicate key row in object dbo.PlatformOutbox'), {
        number: 2627,
      }),
    );
    const { publishCalendarOutboxEvent } = await import('../internal/calendarOutbox');
    await expect(
      publishCalendarOutboxEvent(
        {} as never,
        TENANT,
        'calendar.day.opened',
        { businessDayId: 5 },
        'calendar.day.opened:1:5:1',
      ),
    ).rejects.toMatchObject({ code: 'ALREADY_OPEN_BUSINESS_DAY' });

    publishImpl.mockRejectedValueOnce(
      Object.assign(new Error('Violation of UNIQUE KEY UX_PlatformOutbox_Tenant_Idempotency'), {
        number: 2627,
      }),
    );
    await expect(
      publishCalendarOutboxEvent(
        {} as never,
        TENANT,
        'calendar.day.closed',
        { businessDayId: 5 },
        'calendar.day.closed:1:5:1',
      ),
    ).rejects.toMatchObject({ code: 'BUSINESS_DAY_ALREADY_CLOSED' });
  });
});
