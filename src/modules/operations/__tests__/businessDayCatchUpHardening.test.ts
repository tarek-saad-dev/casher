import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BranchDomainError } from '@/lib/branch/types';
import { BUSINESS_DAY_RECONCILE_USER_MESSAGE } from '@/modules/operations/domain/invariants';

vi.mock('server-only', () => ({}));

const AT_EIGHT_THIRTY = new Date('2026-08-25T05:30:00.000Z');
const AT_TWO = new Date('2026-08-24T23:00:00.000Z');

const BRANCH = {
  branchId: 1,
  branchCode: 'GLEEM',
  isActive: true,
  timeZone: 'Africa/Cairo',
  businessDayCutoffTime: '04:00:00',
};

function mockCatchUpDeps(opts: {
  openDayDate: string | null;
  openDayId?: number;
  failReconcile?: boolean;
  rolledTo?: string;
}) {
  vi.doMock('@/lib/branch/repository', () => ({
    getBranchById: vi.fn(async () => BRANCH),
    listActiveBranches: vi.fn(async () => [BRANCH]),
  }));
  vi.doMock('@/lib/branch/businessDay', () => ({
    getOpenBusinessDay: vi.fn(async () =>
      opts.openDayDate
        ? { id: opts.openDayId ?? 10, branchId: 1, newDay: opts.openDayDate, status: true }
        : null,
    ),
  }));
  vi.doMock('@/modules/operations/infra/businessDayMutationTx', async (importOriginal) => {
    const actual =
      await importOriginal<typeof import('@/modules/operations/infra/businessDayMutationTx')>();
    return {
      ...actual,
      executeReconcileBusinessDay: vi.fn(async () => {
        if (opts.failReconcile) {
          throw new Error('simulated rollover failure');
        }
        return {
          branchId: 1,
          action: 'ROLLED_OVER',
          previousBusinessDayId: 10,
          previousBusinessDate: opts.openDayDate ?? undefined,
          currentBusinessDayId: 11,
          currentBusinessDate: opts.rolledTo ?? '2026-08-25',
          closedShiftCount: 0,
        };
      }),
    };
  });
}

describe('Phase 2B catch-up hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('server-only', () => ({}));
  });

  it('STRICT + 08:30 stale day + reconcile failure → throws BUSINESS_DAY_RECONCILIATION_FAILED', async () => {
    mockCatchUpDeps({ openDayDate: '2026-08-24', failReconcile: true });
    const { ensureBusinessDayCurrent } = await import(
      '@/modules/operations/application/reconcileBusinessDay'
    );
    await expect(
      ensureBusinessDayCurrent(1, { mode: 'STRICT', now: AT_EIGHT_THIRTY }),
    ).rejects.toMatchObject({
      name: 'BranchDomainError',
      code: 'BUSINESS_DAY_RECONCILIATION_FAILED',
      status: 503,
      message: BUSINESS_DAY_RECONCILE_USER_MESSAGE,
    });
  });

  it('BEST_EFFORT + 08:30 stale day + reconcile failure → returns stale FAILED without throwing', async () => {
    mockCatchUpDeps({ openDayDate: '2026-08-24', failReconcile: true });
    const { ensureBusinessDayCurrent } = await import(
      '@/modules/operations/application/reconcileBusinessDay'
    );
    const result = await ensureBusinessDayCurrent(1, {
      mode: 'BEST_EFFORT',
      now: AT_EIGHT_THIRTY,
    });
    expect(result.action).toBe('FAILED');
    expect(result.stale).toBe(true);
    expect(result.expectedBusinessDate).toBe('2026-08-25');
    expect(result.openBusinessDate).toBe('2026-08-24');
    expect(result.errorCode).toBe('BUSINESS_DAY_RECONCILIATION_FAILED');
  });

  it('STRICT + 08:30 stale day + successful catch-up → continues on today', async () => {
    mockCatchUpDeps({ openDayDate: '2026-08-24', rolledTo: '2026-08-25' });
    const { ensureBusinessDayCurrent } = await import(
      '@/modules/operations/application/reconcileBusinessDay'
    );
    const result = await ensureBusinessDayCurrent(1, {
      mode: 'STRICT',
      now: AT_EIGHT_THIRTY,
    });
    expect(result.action).toBe('ROLLED_OVER');
    expect(result.stale).toBe(false);
    expect(result.currentBusinessDate).toBe('2026-08-25');
  });

  it('02:00 stale calendar date → STRICT does not throw (previous business day still valid)', async () => {
    mockCatchUpDeps({ openDayDate: '2026-08-24', failReconcile: true });
    const { ensureBusinessDayCurrent } = await import(
      '@/modules/operations/application/reconcileBusinessDay'
    );
    const result = await ensureBusinessDayCurrent(1, { mode: 'STRICT', now: AT_TWO });
    expect(result.action).toBe('NO_OP');
    expect(result.stale).toBe(false);
    expect(result.currentBusinessDate).toBe('2026-08-24');
  });

  it('08:30 stale day + reconciliation failure → DAY financial gate rejects', async () => {
    vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
      ensureBusinessDayCurrent: vi.fn(async () => {
        throw new BranchDomainError(
          'BUSINESS_DAY_RECONCILIATION_FAILED',
          BUSINESS_DAY_RECONCILE_USER_MESSAGE,
          503,
        );
      }),
    }));
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: () => true,
      requireActiveBranchContext: vi.fn(),
      requireBranchOperationAccess: vi.fn(async () => ({
        userId: 7,
        branchId: 1,
        branchCode: 'GLEEM',
        canOperate: true,
      })),
    }));
    vi.doMock('@/lib/branch/businessDay', () => ({
      getOpenBusinessDay: vi.fn(async () => ({
        id: 10,
        branchId: 1,
        newDay: '2026-08-24',
        status: true,
      })),
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShiftForBranch: vi.fn(async () => null),
      getUserOpenShift: vi.fn(async () => null),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getUserActiveStatus: vi.fn(async () => ({ exists: true, isDeleted: false })),
      getBranchById: vi.fn(async () => BRANCH),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async () => ({ canOperate: true, branchId: 1 })),
    }));

    const { resolveBranchDayAndShiftForWrite } = await import('@/lib/branch/operationalGates');
    const gated = await resolveBranchDayAndShiftForWrite(7);
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.response.status).toBe(503);
      const body = await gated.response.json();
      expect(body.code).toBe('BUSINESS_DAY_RECONCILIATION_FAILED');
      expect(body.error).toBe(BUSINESS_DAY_RECONCILE_USER_MESSAGE);
    }
  });

  it('08:30 stale day + reconciliation failure → shift open rejected', async () => {
    vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
      ensureBusinessDayCurrent: vi.fn(async () => {
        throw new BranchDomainError(
          'BUSINESS_DAY_RECONCILIATION_FAILED',
          BUSINESS_DAY_RECONCILE_USER_MESSAGE,
          503,
        );
      }),
    }));
    vi.doMock('@/modules/operations/infra/shiftMutationTx', () => ({
      executeOpenOrHandoffShift: vi.fn(async () => {
        throw new Error('shift TX must not run');
      }),
    }));

    const { openShiftSession } = await import(
      '@/modules/operations/application/openShiftSession'
    );
    await expect(
      openShiftSession(
        {
          userId: 7,
          branchId: 1,
          branchCode: 'GLEEM',
          branchName: 'جليم',
          shortName: 'جليم',
          timeZone: 'Africa/Cairo',
          businessDayCutoffTime: '04:00:00',
          canOperate: true,
          canViewReports: true,
          canSwitch: true,
        },
        7,
        1,
      ),
    ).rejects.toMatchObject({ code: 'BUSINESS_DAY_RECONCILIATION_FAILED', status: 503 });
  });

  it('DAY/SHIFT writes share the fail-closed financial gate; past-date routes stay on explicit date lookup', () => {
    const sales = readFileSync(join(process.cwd(), 'src/app/api/sales/route.ts'), 'utf8');
    const expenses = readFileSync(join(process.cwd(), 'src/app/api/expenses/route.ts'), 'utf8');
    const incomes = readFileSync(join(process.cwd(), 'src/app/api/incomes/route.ts'), 'utf8');
    const pastExpense = readFileSync(
      join(process.cwd(), 'src/app/api/expenses/past-date/route.ts'),
      'utf8',
    );
    expect(sales).toContain('resolveBranchDayAndShiftForWrite');
    expect(expenses).toContain('resolveBranchDayAndShiftForWrite');
    expect(incomes).toContain('resolveBranchDayAndShiftForWrite');
    expect(pastExpense).toContain('resolveBranchDayForDate');
    expect(pastExpense).not.toContain('resolveBranchDayAndShiftForWrite');

    const src = readFileSync(join(process.cwd(), 'src/lib/branch/operationalGates.ts'), 'utf8');
    const pastFn = src.slice(src.indexOf('export async function resolveBranchDayForDate'));
    const pastBody = pastFn.slice(
      0,
      pastFn.indexOf('export async function resolveActiveBranchDayForPosWrite'),
    );
    expect(pastBody).not.toContain('ensureBusinessDayCurrent');
    expect(pastBody).toContain('getBusinessDayByDate');
  });

  it('DAY and SHIFT mutation contexts use STRICT catch-up', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/modules/operations/application/OperationalContextService.ts'),
      'utf8',
    );
    expect(src).toContain("mode: 'STRICT'");
    expect(src).toContain('resolveDayScope');
    expect(src).toContain('resolveShiftScope');
    expect(src.match(/mode: 'STRICT'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('open/handoff shift guarantee current day via STRICT catch-up', () => {
    const openSrc = readFileSync(
      join(process.cwd(), 'src/modules/operations/application/openShiftSession.ts'),
      'utf8',
    );
    const handoffSrc = readFileSync(
      join(process.cwd(), 'src/modules/operations/application/handoffShiftSession.ts'),
      'utf8',
    );
    expect(openSrc).toContain("mode: 'STRICT'");
    expect(handoffSrc).toContain("mode: 'STRICT'");
  });
});
