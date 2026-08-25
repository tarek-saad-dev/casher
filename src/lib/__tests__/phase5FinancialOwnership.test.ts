/**
 * Phase 5 — Financial Ownership Completion (no live DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  FINANCIAL_OWNERSHIP_MATRIX,
  PURCHASE_OWNERSHIP_POLICY,
  assertTransactionOwnershipConsistency,
  currentFinancialOwnership,
  finalizeCurrentFinancialWrite,
  finalizeHistoricalFinancialWrite,
  historicalFinancialContext,
  rejectClientOwnershipFields,
  rejectConflictingClientOwnership,
} from '@/lib/branch/financialOwnershipPolicy';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const gleemGated = {
  branch: { branchId: 1 },
  day: { id: 10, branchId: 1, newDay: '2026-08-25' },
  shift: { id: 100, branchId: 1, businessDayId: 10 },
};

describe('Phase 5 financial ownership matrix', () => {
  it('classifies operational commands as SHIFT or HISTORICAL with an explicit purchase policy', () => {
    expect(FINANCIAL_OWNERSHIP_MATRIX['sale.create'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['sale.create'].requiresOpenShift).toBe(true);
    expect(FINANCIAL_OWNERSHIP_MATRIX['service_payment.create'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['expense.create'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['income.create'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['deduction.create'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['treasury.transfer.current'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['booking.convert'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['pos.tip'].scope).toBe('SHIFT');
    expect(FINANCIAL_OWNERSHIP_MATRIX['payroll.cash_post'].scope).toBe('HISTORICAL');
    expect(FINANCIAL_OWNERSHIP_MATRIX['expense.past_date'].scope).toBe('HISTORICAL');
    expect(FINANCIAL_OWNERSHIP_MATRIX['income.past_date'].scope).toBe('HISTORICAL');
    expect(FINANCIAL_OWNERSHIP_MATRIX['treasury.transfer.historical'].scope).toBe('HISTORICAL');
    expect(PURCHASE_OWNERSHIP_POLICY.allowDayFallback).toBe(true);
    expect(PURCHASE_OWNERSHIP_POLICY.requiresOpenShift).toBe(false);
    expect(FINANCIAL_OWNERSHIP_MATRIX['purchase.create']).toEqual(PURCHASE_OWNERSHIP_POLICY);
  });
});

describe('Phase 5 current-day ownership', () => {
  it('view CAMP + operate GLEEM stamps GLEEM Branch/Day/Shift for a sale', () => {
    const result = currentFinancialOwnership('sale.create', gleemGated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ownership).toEqual({
      scope: 'SHIFT',
      branchId: 1,
      businessDayId: 10,
      businessDate: '2026-08-25',
      shiftMoveId: 100,
    });
  });

  it('expense, income, and booking conversion share the same SHIFT ownership', () => {
    for (const command of ['expense.create', 'income.create', 'booking.convert'] as const) {
      const result = currentFinancialOwnership(command, gleemGated);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.ownership.branchId).toBe(1);
      expect(result.ownership.businessDayId).toBe(10);
      expect(result.ownership.shiftMoveId).toBe(100);
    }
  });

  it('purchase stamps BranchID + BusinessDayID and keeps SHIFT when an open shift exists', () => {
    const result = currentFinancialOwnership('purchase.create', gleemGated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ownership.branchId).toBe(1);
    expect(result.ownership.businessDayId).toBe(10);
    expect(result.ownership.shiftMoveId).toBe(100);
    expect(result.ownership.scope).toBe('SHIFT');
  });

  it('purchase DAY fallback stamps BusinessDayID with ShiftMoveID null', () => {
    const result = currentFinancialOwnership('purchase.create', {
      ...gleemGated,
      shift: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ownership.scope).toBe('DAY');
    expect(result.ownership.businessDayId).toBe(10);
    expect(result.ownership.shiftMoveId).toBeNull();
  });

  it('rejects client-supplied conflicting ownership on create', async () => {
    const rejected = finalizeCurrentFinancialWrite('sale.create', gleemGated, {
      items: [],
      BranchID: 2,
      BusinessDayID: 99,
      ShiftMoveID: 7,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.response.status).toBe(400);
    const body = await rejected.response.json();
    expect(body.code).toBe('CLIENT_OWNERSHIP_NOT_ALLOWED');
  });

  it('rejects SHIFT ownership when shift branch/day disagrees with the transaction', () => {
    const mismatch = currentFinancialOwnership('sale.create', {
      branch: { branchId: 1 },
      day: { id: 10, branchId: 1, newDay: '2026-08-25' },
      shift: { id: 100, branchId: 2, businessDayId: 10 },
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error.code).toBe('SHIFT_BRANCH_MISMATCH');

    const dayMismatch = currentFinancialOwnership('sale.create', {
      branch: { branchId: 1 },
      day: { id: 10, branchId: 1, newDay: '2026-08-25' },
      shift: { id: 100, branchId: 1, businessDayId: 11 },
    });
    expect(dayMismatch.ok).toBe(false);
    if (dayMismatch.ok) return;
    expect(dayMismatch.error.code).toBe('SHIFT_DAY_MISMATCH');
  });

  it('sale.create fails closed without an OPEN shift', () => {
    const result = currentFinancialOwnership('sale.create', { ...gleemGated, shift: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_OPEN_SHIFT');
  });
});

describe('Phase 5 historical ownership', () => {
  it('resolves the requested historical BusinessDay and never a current ShiftMoveID', () => {
    const result = historicalFinancialContext(2, {
      id: 44,
      branchId: 2,
      newDay: '2026-08-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ownership).toEqual({
      scope: 'HISTORICAL',
      branchId: 2,
      businessDayId: 44,
      businessDate: '2026-08-01',
      shiftMoveId: null,
    });
  });

  it('does not attach today\'s open shift to a historical write', async () => {
    const finalized = finalizeHistoricalFinancialWrite(
      2,
      { id: 44, branchId: 2, newDay: '2026-08-01' },
      { ShiftMoveID: 100, BusinessDayID: 10 },
    );
    expect(finalized.ok).toBe(false);
    if (finalized.ok) return;
    const body = await finalized.response.json();
    expect(body.code).toBe('CLIENT_OWNERSHIP_NOT_ALLOWED');
  });

  it('rejects historical context when the day belongs to another branch', () => {
    const result = historicalFinancialContext(2, {
      id: 10,
      branchId: 1,
      newDay: '2026-08-25',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OWNERSHIP_DAY_BRANCH_MISMATCH');
  });

  it('assertTransactionOwnershipConsistency rejects a historical record with a shift id', () => {
    const err = assertTransactionOwnershipConsistency({
      scope: 'HISTORICAL',
      branchId: 2,
      businessDayId: 44,
      shiftMoveId: 100,
    });
    expect(err?.code).toBe('HISTORICAL_SHIFT_NOT_ALLOWED');
  });
});

describe('Phase 5 mutation ownership', () => {
  it('loadFinancialEntityOwnership queries BranchID + BusinessDayID + ShiftMoveID in one statement', () => {
    const src = read('src/lib/branch/financialOwnership.ts');
    expect(src).toContain('h.BranchID');
    expect(src).toContain('h.BusinessDayID');
    expect(src).toContain('h.ShiftMoveID');
    expect(src).toContain('sm.BranchID AS ShiftBranchID');
    expect(src).toContain('loadAndAuthorizeFinancialMutation');
    expect(src).toContain('validateUserBranchAccess');
    expect(src).not.toMatch(/assertActiveBranchOwns\(.*ViewBranch/);
  });

  it('authorizeFinancialMutation does not compare ViewBranch', () => {
    const src = read('src/lib/branch/financialOwnership.ts');
    const fn = src.slice(src.indexOf('export async function authorizeFinancialMutation'));
    const body = fn.slice(0, fn.indexOf('export async function loadAndAuthorizeFinancialMutation'));
    expect(body).toContain('validateUserBranchAccess');
    expect(body).not.toContain('requireActiveBranchContext');
    expect(body).not.toContain('requireBranchOperationAccess');
    expect(body).toContain('assertTransactionOwnershipConsistency');
  });

  it('rejects conflicting client ownership on mutate, ignores matching fields', () => {
    const server = { branchId: 1, businessDayId: 10, shiftMoveId: 100 };
    expect(rejectConflictingClientOwnership({ BranchID: 1, ShiftMoveID: 100 }, server)).toBeNull();
    expect(rejectConflictingClientOwnership({ BranchID: 2 }, server)?.code).toBe(
      'CLIENT_OWNERSHIP_CONFLICT',
    );
  });

  it('sales/expenses/incomes mutation routes load full ownership, not BranchID only', () => {
    expect(read('src/app/api/sales/[id]/route.ts')).toContain('loadAndAuthorizeFinancialMutation');
    expect(read('src/app/api/expenses/[id]/route.ts')).toContain('loadAndAuthorizeFinancialMutation');
    expect(read('src/app/api/incomes/[id]/route.ts')).toContain('loadAndAuthorizeFinancialMutation');
    expect(read('src/app/api/incomes/bulk-update/route.ts')).toContain('loadCashMoveOwnershipBatch');
  });
});

describe('Phase 5 route wiring', () => {
  it('current-day writes still go through resolveBranchDayAndShiftForWrite then the shared policy', () => {
    const sales = read('src/app/api/sales/route.ts');
    const expenses = read('src/app/api/expenses/route.ts');
    const incomes = read('src/app/api/incomes/route.ts');
    const purchases = read('src/app/api/purchases/route.ts');
    const convert = read('src/app/api/bookings/[id]/convert/route.ts');
    const tips = read('src/app/api/pos/tips/route.ts');
    expect(sales).toContain('resolveBranchDayAndShiftForWrite');
    expect(sales).toContain("finalizeCurrentFinancialWrite(\"sale.create\"");
    expect(expenses).toContain('finalizeCurrentFinancialWrite(\'expense.create\'');
    expect(incomes).toContain('finalizeCurrentFinancialWrite(\'income.create\'');
    expect(incomes).toContain('owned.ownership.businessDate');
    expect(purchases).toContain('finalizeCurrentFinancialWrite(\'purchase.create\'');
    expect(purchases).toContain('BusinessDayID');
    expect(convert).toContain('finalizeCurrentFinancialWrite("booking.convert"');
    expect(tips).toContain('shiftMoveId: owned.ownership.shiftMoveId');
  });

  it('historical writes use resolveBranchDayForDate + HistoricalFinancialContext, not the current SHIFT gate', () => {
    const pastExpense = read('src/app/api/expenses/past-date/route.ts');
    const pastIncome = read('src/app/api/incomes/past-date/route.ts');
    const payroll = read('src/app/api/payroll/daily/post-to-cash/route.ts');
    const treasury = read('src/app/api/treasury/transfer/route.ts');
    expect(pastExpense).toContain('resolveBranchDayForDate');
    expect(pastExpense).toContain('finalizeHistoricalFinancialWrite');
    expect(pastExpense).not.toContain('resolveBranchDayAndShiftForWrite');
    expect(pastIncome).toContain('finalizeHistoricalFinancialWrite');
    expect(payroll).toContain('finalizeHistoricalFinancialWrite');
    expect(treasury).toContain('finalizeHistoricalFinancialWrite');
    expect(treasury).toContain('finalizeCurrentFinancialWrite');
  });

  it('purchase migration adds nullable BusinessDayID without backfill', () => {
    const sql = read('db/migrations/add-purchase-business-day-id.sql');
    expect(sql).toContain('TblinvPurchaseHead');
    expect(sql).toContain('BusinessDayID INT NULL');
    expect(sql).toContain('FK_TblinvPurchaseHead_BusinessDayID');
    expect(sql).not.toMatch(/UPDATE\s+dbo\.TblinvPurchaseHead/i);
  });
});

describe('Phase 5 still fail-closed on stale/closed current day', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolveBranchDayAndShiftForWrite still uses SHIFT operational snapshot (not ViewBranch)', async () => {
    const requireBranchOperationAccess = vi.fn(async () => ({
      userId: 7,
      branchId: 2,
      branchCode: 'CAMP_CAESAR',
    }));
    vi.doMock('@/lib/branch/context', () => ({
      isActiveBranchContext: () => true,
      requireActiveBranchContext: vi.fn(),
      requireBranchOperationAccess,
    }));
    vi.doMock('@/lib/branch/shiftSession', () => ({
      getUserOpenShift: vi.fn(async () => ({
        id: 100,
        branchId: 1,
        businessDayId: 10,
        newDay: '2026-08-25',
        userId: 7,
        shiftId: 1,
        status: true,
      })),
      getUserOpenShiftForBranch: vi.fn(),
    }));
    vi.doMock('@/modules/operations/application/OperationalContextService', () => ({
      requireOperationalSnapshot: vi.fn(async () => ({
        context: { userId: 7, branchId: 1, businessDayId: 10, businessDate: '2026-08-25', shiftSessionId: 100 },
        day: { id: 10, branchId: 1, newDay: '2026-08-25', status: true },
        shift: {
          id: 100,
          branchId: 1,
          businessDayId: 10,
          newDay: '2026-08-25',
          userId: 7,
          shiftId: 1,
          status: true,
        },
      })),
    }));
    vi.doMock('@/lib/branch/repository', () => ({
      getBranchById: vi.fn(async (id: number) =>
        id === 1
          ? {
              branchId: 1,
              branchCode: 'GLEEM',
              branchName: 'جليم',
              shortName: 'جليم',
              isActive: true,
              timeZone: 'Africa/Cairo',
              businessDayCutoffTime: '04:00:00',
            }
          : null,
      ),
    }));
    vi.doMock('@/lib/branch/access', () => ({
      validateUserBranchAccess: vi.fn(async () => ({
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      })),
    }));
    vi.doMock('@/modules/operations/application/reconcileBusinessDay', () => ({
      ensureBusinessDayCurrent: vi.fn(async () => ({ action: 'NO_OP', stale: false })),
    }));
    vi.doMock('@/modules/operations/requestScope', () => ({
      withOperationalRequestScope: async (fn: () => Promise<unknown>) => fn(),
    }));
    vi.doMock('@/modules/operations/infra/businessDayLock', () => ({
      lockOperationalWrite: vi.fn(),
    }));

    const { resolveBranchDayAndShiftForWrite } = await import('@/lib/branch/operationalGates');
    const gated = await resolveBranchDayAndShiftForWrite(7);
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    const owned = currentFinancialOwnership('sale.create', gated);
    expect(owned.ok).toBe(true);
    if (!owned.ok) return;
    expect(owned.ownership.branchId).toBe(1);
    expect(owned.ownership.shiftMoveId).toBe(100);
    expect(requireBranchOperationAccess).not.toHaveBeenCalled();
  });

  it('STRICT catch-up remains on DAY/SHIFT operational snapshot', () => {
    const src = read('src/modules/operations/application/OperationalContextService.ts');
    expect(src).toContain("mode: 'STRICT'");
  });
});

describe('Phase 5 client ownership helper', () => {
  it('treats absent fields as allowed', () => {
    expect(rejectClientOwnershipFields({ amount: 10, expINID: 3 })).toBeNull();
    expect(rejectClientOwnershipFields({ BranchID: 1 })?.code).toBe('CLIENT_OWNERSHIP_NOT_ALLOWED');
  });
});
