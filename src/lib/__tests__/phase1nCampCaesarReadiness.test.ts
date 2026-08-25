import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import fs from 'fs';
import path from 'path';
import {
  INTERNAL_LIVE_SMOKE_PROOF_KEYS,
  isAllowedSmokeBranchCode,
} from '@/lib/branch/smokeBranchPolicy';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1N Camp Caesar readiness hardening', () => {
  it('allows CAMP_CAESAR and PH1GTEST as smoke branches; never GLEEM', () => {
    expect(isAllowedSmokeBranchCode('CAMP_CAESAR')).toBe(true);
    expect(isAllowedSmokeBranchCode('PH1GTEST')).toBe(true);
    expect(isAllowedSmokeBranchCode('GLEEM')).toBe(false);
  });

  it('requires smoke blockers for service/payment/inventory/schedule', () => {
    const svc = read('src/lib/branch/branchReadinessService.ts');
    expect(svc).toContain('smoke.service_price');
    expect(svc).toContain('smoke.service_duration');
    expect(svc).toContain('smoke.payment_method');
    expect(svc).toContain('smoke.inventory_container');
    expect(svc).toContain('smoke.product');
    expect(svc).toContain('smoke.work_schedule');
    expect(svc).toContain('smoke.operator');
    expect(svc).toContain('smoke.notifications_off');
    expect(svc).toContain('smoke.public_booking_off');
    expect(svc).toContain('smoke.gleem_baseline');
  });

  it('blocks INTERNAL_LIVE without smoke proofs and business decisions', () => {
    const svc = read('src/lib/branch/branchReadinessService.ts');
    const policy = read('src/lib/branch/smokeBranchPolicy.ts');
    expect(svc).toContain('internal.passed_smoke_run');
    expect(svc).toContain('proof.');
    expect(svc).toContain('biz.address');
    expect(svc).toContain('BUSINESS_DECISION_REQUIRED');
    expect(svc).toContain('INTERNAL_LIVE_SMOKE_PROOF_KEYS');
    for (const key of INTERNAL_LIVE_SMOKE_PROOF_KEYS) {
      expect(policy).toContain(key);
    }
  });

  it('marks public frontend as PUBLIC_LIVE blocker not warning', () => {
    const svc = read('src/lib/branch/branchReadinessService.ts');
    expect(svc).toContain("key: 'public.frontend_multi_branch'");
    expect(svc).toContain("requiredFor: ['public_live']");
    expect(svc).toContain("status: p.pass ? 'pass' : 'blocker'");
  });

  it('score cannot bypass blockers (readyFor uses blockers only)', () => {
    const svc = read('src/lib/branch/branchReadinessService.ts');
    expect(svc).toContain('function readyFor');
    expect(svc).toContain("i.status === 'blocker'");
    expect(svc).toContain('isReadyForSmoke: readyFor');
  });
});

describe('Phase 1N Camp Caesar inventory / POS / payroll source contracts', () => {
  it('inventory adjustment requires transaction and stock-tracked product rule', () => {
    const inv = read('src/lib/inventory/purchaseInventory.service.ts');
    const mut = read('src/lib/inventory/inventoryMutation.service.ts');
    expect(inv).toContain('applyManualStockAdjustment');
    expect(inv).toContain('transaction: sql.Transaction');
    expect(mut).toContain('isStockTrackedProduct');
    expect(mut).toContain('TblBranchInventory');
  });

  it('POS sales stamp BranchID from session gate not body', () => {
    const sales = read('src/app/api/sales/route.ts');
    expect(sales).toContain('resolveBranchDayAndShiftForWrite');
    expect(sales).toContain('Never trust browser branchId');
    expect(sales).toContain('BranchID');
  });

  it('hourly dual-write and monthly post require branchId', () => {
    const dual = read('src/lib/services/employeeLedgerDualWrite.ts');
    const month = read('src/lib/services/employeeLedgerMonthlySalaryService.ts');
    expect(dual).toContain('runDailyPayrollGenerateWithOptionalLedger');
    expect(dual).toContain('branchId');
    expect(month).toContain('postMonthlySalaryEntitlements');
    expect(month).toContain('dryRun');
  });

  it('Camp Caesar smoke runner covers hard proofs and refuses GLEEM', () => {
    const runner = read('scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts');
    expect(runner).toContain('CAMP_CAESAR');
    expect(runner).toContain('applyManualStockAdjustment');
    expect(runner).toContain('TblinvServHead');
    expect(runner).toContain('runDailyPayrollGenerateWithOptionalLedger');
    expect(runner).toContain('dryRun: false');
    expect(runner).toContain('generateEmployeeDailyTargets');
    expect(runner).toContain('executeEmployeePayout');
    expect(runner).toContain('assertSmokeBranch(1)');
    expect(runner).not.toContain('allowInactive');
  });
});

describe('Phase 1N Camp Caesar isolation', () => {
  it('smoke context and assignment lookup use allowlist not PH1GTEST-only', () => {
    const ctx = read('src/lib/branch/smokeExecutionContext.ts');
    const repo = read('src/lib/branch/repository.ts');
    expect(ctx).toContain('isAllowedSmokeBranchCode');
    expect(repo).toContain('isAllowedSmokeBranchCode');
    expect(repo).not.toMatch(/BranchCode = N'PH1GTEST'/);
  });

  it('cleanup returns any allowed smoke branch code to SETUP', () => {
    const svc = read('src/lib/branch/branchSmokeService.ts');
    expect(svc).toContain('BranchCode = @code');
    expect(svc).not.toMatch(/WHERE BranchID = @branchId AND BranchCode = N'PH1GTEST'/);
  });
});
