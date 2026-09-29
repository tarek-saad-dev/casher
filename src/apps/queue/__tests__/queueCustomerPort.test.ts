import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';

const upsert = vi.hoisted(() => vi.fn(async () => 77));

vi.mock('@/lib/queue/queuePortLegacyBridge', () => ({
  bridgeQueueUpsertCustomer: (...args: unknown[]) => upsert(...args),
  bridgeQueueAssertEmployeeFree: vi.fn(),
  bridgeQueueCommitOccupancy: vi.fn(),
  bridgeQueuePublishCreatedEvent: vi.fn(),
  bridgeQueueAcquireAnyBarberLock: vi.fn(),
  BookingCreateLockError: class BookingCreateLockError extends Error {},
}));

import { assignQueueCustomerThroughPort } from '@/lib/operationsQueueCreateCore';

describe('queue customer port', () => {
  beforeEach(() => {
    upsert.mockClear();
    upsert.mockResolvedValue(77);
  });

  it('routes phone identity through Customers upsertByPhone', async () => {
    const hooks = { upsertCustomer: vi.fn() };
    const tx = { id: 'tx' } as unknown as Transaction;
    const result = await assignQueueCustomerThroughPort(
      { queuePortHooks: hooks as never },
      tx,
      { name: '  Nour  ', phone: ' 01012345678 ' },
    );

    expect(result).toEqual({
      clientId: 77,
      name: 'Nour',
      phone: '01012345678',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      { queuePortHooks: hooks },
      tx,
      'Nour',
      '01012345678',
    );
  });

  it('refuses the port helper when hooks are absent', async () => {
    await expect(
      assignQueueCustomerThroughPort(
        {},
        {} as Transaction,
        { phone: '01012345678' },
      ),
    ).rejects.toThrow('QUEUE_CUSTOMER_PORT_REQUIRED');
    expect(upsert).not.toHaveBeenCalled();
  });
});
