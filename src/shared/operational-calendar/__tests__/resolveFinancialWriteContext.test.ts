import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BranchDomainError } from '@/lib/branch/types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const staffActor = {
  actorType: 'staff' as const,
  actorId: '7',
  tenantId: TENANT,
  membershipId: null,
  viewLocationId: null,
};

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

const getUserOpenShiftInTransaction = vi.fn(async () => null);
const lockOperationalWrite = vi.fn(async () => ({
  day: { id: 10, branchId: 2, newDay: '2026-09-28', status: true },
  shift: { id: 99, branchId: 2, businessDayId: 10, status: true },
}));

vi.mock('../internal/transactionReads', () => ({
  getUserOpenShiftInTransaction: (...args: unknown[]) => getUserOpenShiftInTransaction(...args),
}));

vi.mock('@/modules/operations/infra/businessDayLock', () => ({
  lockOperationalWrite: (...args: unknown[]) => lockOperationalWrite(...args),
  lockCurrentOpenBusinessDay: vi.fn(async () => ({
    id: 20,
    branchId: 1,
    newDay: '2026-09-29',
    status: true,
  })),
}));

describe('resolveFinancialWriteContextInTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns DAY scope when user has no open shift', async () => {
    const { resolveFinancialWriteContextInTransaction } = await import(
      '../internal/resolveFinancialWriteContext'
    );
    const tx = {} as never;
    const ctx = await resolveFinancialWriteContextInTransaction(tx, TENANT, staffActor, {
      locationId: 1,
    });
    expect(ctx.scope).toBe('DAY');
    expect(ctx.shiftInstanceId).toBeNull();
    expect(ctx.locationId).toBe(1);
    expect(ctx.businessDayId).toBe(20);
  });

  it('SHIFT scope uses operational branch and locks on caller transaction', async () => {
    const order: string[] = [];
    getUserOpenShiftInTransaction.mockImplementationOnce(async () => {
      order.push('peek-shift');
      return {
        id: 99,
        branchId: 2,
        businessDayId: 10,
        newDay: '2026-09-28',
        status: true,
        userId: 7,
        shiftId: 1,
        startDate: null,
        startTime: null,
        endDate: null,
        endTime: null,
      };
    });
    lockOperationalWrite.mockImplementationOnce(async () => {
      order.push('lock-day-then-shift');
      return {
        day: { id: 10, branchId: 2, newDay: '2026-09-28', status: true },
        shift: { id: 99, branchId: 2, businessDayId: 10, status: true },
      };
    });
    const { resolveFinancialWriteContextInTransaction } = await import(
      '../internal/resolveFinancialWriteContext'
    );
    const tx = { marker: 'caller-tx' } as never;
    const ctx = await resolveFinancialWriteContextInTransaction(tx, TENANT, staffActor, {
      locationId: 1,
    });
    expect(order).toEqual(['peek-shift', 'lock-day-then-shift']);
    expect(getUserOpenShiftInTransaction).toHaveBeenCalledWith(tx, 7);
    expect(lockOperationalWrite).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ branchId: 2, shiftSessionId: 99, requireShift: true }),
    );
    expect(ctx.scope).toBe('SHIFT');
    expect(ctx.locationId).toBe(2);
    expect(ctx.shiftInstanceId).toBe(99);
  });

  it('rejects tenant mismatch', async () => {
    const { resolveFinancialWriteContextInTransaction } = await import(
      '../internal/resolveFinancialWriteContext'
    );
    await expect(
      resolveFinancialWriteContextInTransaction({} as never, TENANT, {
        ...staffActor,
        tenantId: 'wrong',
      }, { locationId: 1 }),
    ).rejects.toBeInstanceOf(BranchDomainError);
  });
});
