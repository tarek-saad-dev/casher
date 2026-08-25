import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchDomainError } from '@/lib/branch/types';

vi.mock('server-only', () => ({}));

const GLEEM_DAY = {
  id: 10,
  branchId: 1,
  newDay: '2026-08-24',
  status: true,
};

const CAMP_DAY = {
  id: 20,
  branchId: 2,
  newDay: '2026-08-24',
  status: true,
};

const GLEEM_SHIFT = {
  id: 100,
  branchId: 1,
  businessDayId: 10,
  newDay: '2026-08-24',
  userId: 7,
  shiftId: 1,
  startDate: '2026-08-24',
  startTime: '10:00 AM',
  endDate: null,
  endTime: null,
  status: true,
};

const CAMP_SHIFT = {
  ...GLEEM_SHIFT,
  id: 200,
  branchId: 2,
  businessDayId: 20,
};

function mockOperatorAccess(opts?: { canOperate?: boolean; throwAccess?: boolean }) {
  vi.doMock('@/lib/branch/repository', () => ({
    getUserActiveStatus: vi.fn(async () => ({ exists: true, isDeleted: false })),
    getBranchById: vi.fn(async (id: number) =>
      id === 1 || id === 2
        ? {
            branchId: id,
            branchCode: id === 1 ? 'GLEEM' : 'CAMP_CAESAR',
            isActive: true,
            timeZone: 'Africa/Cairo',
            businessDayCutoffTime: '04:00:00',
          }
        : null,
    ),
    branchNow: () => new Date(),
  }));
  vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
    ensureBusinessDayCurrent: vi.fn(async () => ({ branchId: 1, action: 'NO_OP' })),
  }));
  vi.doMock('@/lib/branch/access', () => ({
    validateUserBranchAccess: vi.fn(async () => {
      if (opts?.throwAccess) {
        throw new BranchDomainError('NO_BRANCH_ACCESS', 'لا يوجد ربط فرع صالح لهذا المستخدم', 403);
      }
      return { canOperate: opts?.canOperate !== false, branchId: 1 };
    }),
  }));
  vi.doMock('@/lib/branch/context', () => ({
    getActiveBranchContext: vi.fn(async () => ({
      userId: 7,
      branchId: 1,
      canOperate: true,
    })),
  }));
}

describe('requireOperationalContext', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('DAY scope: branch with no open day', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => null),
      getBusinessDayById: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => null),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    await expect(
      requireOperationalContext({ userId: 7, branchId: 1, scope: 'DAY' }),
    ).rejects.toMatchObject({ code: 'NO_OPEN_DAY', status: 400 });
  });

  it('DAY scope: branch with open day and no shift', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => GLEEM_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => null),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    const ctx = await requireOperationalContext({ userId: 7, branchId: 1, scope: 'DAY' });
    expect(ctx).toEqual({
      userId: 7,
      branchId: 1,
      businessDayId: 10,
      businessDate: '2026-08-24',
      shiftSessionId: null,
    });
  });

  it('SHIFT scope: user with no shift', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => GLEEM_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => null),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    await expect(
      requireOperationalContext({ userId: 7, scope: 'SHIFT' }),
    ).rejects.toMatchObject({ code: 'NO_OPEN_SHIFT', status: 400 });
  });

  it('DAY scope: user with open shift on the active branch', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => GLEEM_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => GLEEM_SHIFT),
      getUserOpenShiftForBranch: vi.fn(async () => GLEEM_SHIFT),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    const ctx = await requireOperationalContext({ userId: 7, branchId: 1, scope: 'DAY' });
    expect(ctx.shiftSessionId).toBe(100);
    expect(ctx.branchId).toBe(1);
    expect(ctx.businessDayId).toBe(10);
  });

  it('DAY scope ignores an open shift on another branch', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => CAMP_DAY),
      getBusinessDayById: vi.fn(async () => CAMP_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => GLEEM_SHIFT),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    const ctx = await requireOperationalContext({ userId: 7, branchId: 2, scope: 'DAY' });
    expect(ctx.branchId).toBe(2);
    expect(ctx.businessDayId).toBe(20);
    expect(ctx.shiftSessionId).toBeNull();
  });

  it('SHIFT scope derives branchId and businessDayId from the open shift, not the requested session branch', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => CAMP_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => GLEEM_SHIFT),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    const ctx = await requireOperationalContext({ userId: 7, scope: 'SHIFT' });
    expect(ctx.branchId).toBe(1);
    expect(ctx.businessDayId).toBe(10);
    expect(ctx.shiftSessionId).toBe(100);
  });

  it('SHIFT scope without requested branchId uses the OPEN shift branch, not the view cookie', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/context', () => ({
      getActiveBranchContext: vi.fn(async () => ({
        userId: 7,
        branchId: 2,
        canOperate: true,
      })),
    }));
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => CAMP_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => GLEEM_SHIFT),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    const ctx = await requireOperationalContext({ userId: 7, scope: 'SHIFT' });
    expect(ctx.branchId).toBe(1);
    expect(ctx.shiftSessionId).toBe(100);
  });

  it('SHIFT scope rejects when requested branchId does not match the open shift', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => CAMP_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => GLEEM_SHIFT),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    await expect(
      requireOperationalContext({ userId: 7, branchId: 2, scope: 'SHIFT' }),
    ).rejects.toMatchObject({ code: 'SHIFT_BRANCH_MISMATCH' });
  });

  it('rejects shift BusinessDayID / BranchID mismatch on DAY scope', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => GLEEM_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(),
      getUserOpenShiftForBranch: vi.fn(async () => ({
        ...GLEEM_SHIFT,
        businessDayId: 999,
      })),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    await expect(
      requireOperationalContext({ userId: 7, branchId: 1, scope: 'DAY' }),
    ).rejects.toMatchObject({ code: 'SHIFT_DAY_MISMATCH' });
  });

  it('rejects shift whose day row belongs to another branch', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(),
      getBusinessDayById: vi.fn(async () => CAMP_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => GLEEM_SHIFT),
      getUserOpenShiftForBranch: vi.fn(),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    await expect(
      requireOperationalContext({ userId: 7, scope: 'SHIFT' }),
    ).rejects.toMatchObject({ code: 'OPERATIONAL_OWNERSHIP_MISMATCH' });
  });

  it('unauthorized branch is rejected', async () => {
    mockOperatorAccess({ throwAccess: true });
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => GLEEM_DAY),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => null),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    await expect(
      requireOperationalContext({ userId: 7, branchId: 1, scope: 'BRANCH' }),
    ).rejects.toMatchObject({ code: 'NO_BRANCH_ACCESS', status: 403 });
  });

  it('BRANCH scope does not require an open day or shift', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => null),
      getBusinessDayById: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => null),
      getUserOpenShiftForBranch: vi.fn(async () => null),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    const ctx = await requireOperationalContext({ userId: 7, branchId: 1, scope: 'BRANCH' });
    expect(ctx).toEqual({
      userId: 7,
      branchId: 1,
      businessDayId: null,
      businessDate: null,
      shiftSessionId: null,
    });
  });

  it('never uses a client-supplied shift id — SHIFT always loads from DB', async () => {
    mockOperatorAccess();
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(),
      getBusinessDayById: vi.fn(async () => GLEEM_DAY),
    }));
    const getUserOpenShift = vi.fn(async () => GLEEM_SHIFT);
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift,
      getUserOpenShiftForBranch: vi.fn(),
    }));

    const { requireOperationalContext } = await import(
      '@/modules/operations/application/OperationalContextService'
    );
    const ctx = await requireOperationalContext({
      userId: 7,
      scope: 'SHIFT',
      // @ts-expect-error — client ownership fields must not be part of the contract
      shiftSessionId: 999,
    });
    expect(getUserOpenShift).toHaveBeenCalledWith(7);
    expect(ctx.shiftSessionId).toBe(100);
    expect(ctx.shiftSessionId).not.toBe(999);
  });
});
