import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  assertCampCaesarOvernightBoundaries,
  evaluateOvernightSlot,
  CAMP_CAESAR_OVERNIGHT_HOURS,
  workDateForInstant,
  operatingDayForSlot,
} from '@/lib/branch/overnightOperatingHours';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1O Camp Caesar overnight hours', () => {
  it('opens 11:00 and closes 01:30 next day with correct dayOffset', () => {
    assertCampCaesarOvernightBoundaries();
    expect(evaluateOvernightSlot('11:00', CAMP_CAESAR_OVERNIGHT_HOURS)).toMatchObject({
      available: true,
      dayOffset: 0,
    });
    expect(evaluateOvernightSlot('00:30', CAMP_CAESAR_OVERNIGHT_HOURS)).toMatchObject({
      available: true,
      dayOffset: 1,
    });
    expect(evaluateOvernightSlot('01:30', CAMP_CAESAR_OVERNIGHT_HOURS).available).toBe(false);
    expect(evaluateOvernightSlot('10:59', CAMP_CAESAR_OVERNIGHT_HOURS).available).toBe(false);
  });

  it('maps WorkDate via cutoff and operating day via dayOffset', () => {
    expect(workDateForInstant('2026-07-26', '00:30', 4 * 60)).toBe('2026-07-25');
    expect(workDateForInstant('2026-07-26', '11:00', 4 * 60)).toBe('2026-07-26');
    expect(operatingDayForSlot('2026-07-26', 1)).toBe('2026-07-25');
  });
});

describe('Phase 1O Camp Caesar real config source contracts', () => {
  it('has selective template copy and updateBranchSetup', () => {
    const tpl = read('src/lib/branch/branchConfigurationTemplate.ts');
    const upd = read('src/lib/branch/updateBranchSetup.ts');
    expect(tpl).toContain('applyApprovedBranchConfigurationTemplate');
    expect(tpl).toContain('sourceBranchId');
    expect(tpl).toContain('targetBranchId');
    expect(tpl).toContain('sourceBranchId must differ from targetBranchId');
    expect(tpl).toMatch(/SETUP/);
    expect(upd).toContain('updateBranchSetupFields');
    expect(upd).toContain('normalizeEgyptianDisplayPhone');
  });

  it('stores English display without new BranchName column', () => {
    const id = read('src/lib/branch/branchDisplayIdentity.ts');
    const pol = read('src/lib/branch/branchSetupPolicy.ts');
    expect(id).toContain('SalonName');
    expect(id).toContain('englishDisplayName');
    expect(pol).toContain('EnglishDisplayName');
    expect(id).not.toContain('ALTER TABLE');
  });

  it('partner draft is inactive pending opening date', () => {
    const p = read('src/lib/branch/campCaesarPartnerDraft.ts');
    expect(p).toContain('40');
    expect(p).toContain('20');
    expect(p).toContain('PHASE1O_DRAFT_PENDING_OPENING_DATE');
    expect(p).toContain('IsActive = 0');
    expect(p).toContain('PENDING_OPENING_DATE');
  });

  it('employee assignment requires payroll and target/no-target', () => {
    const c = read('src/lib/branch/employeeAssignmentCommit.ts');
    expect(c).toContain('commitEmployeeBranchAssignment');
    expect(c).toContain('NO_TARGET');
    expect(c).toContain('TblEmpBranchPayrollPlan');
    expect(c).toContain('assertNoOverlappingBranchPayrollPlans');
    expect(c).toContain('no cross-branch fallback');
  });

  it('opening inventory options do not invent stock', () => {
    const o = read('src/lib/branch/openingInventoryDecision.ts');
    expect(o).toContain('ZERO_STOCK');
    expect(o).toContain('NEW_PURCHASE');
    expect(o).toContain('TRANSFER_FROM_GLEEM');
    expect(o).toContain('approveZeroStock');
  });

  it('readiness keeps internal-live blockers and public gates', () => {
    const svc = read('src/lib/branch/branchReadinessService.ts');
    for (const key of [
      'biz.address',
      'biz.contact',
      'biz.operating_hours',
      'biz.opening_cash',
      'biz.opening_inventory',
      'biz.partner_shares_effective_date',
      'biz.real_employees',
      'payroll.plan_coverage',
      'target.policy_coverage',
      'printer.shared_policy',
      'whatsapp.shared_policy',
      'users.access_review',
      'public.frontend_multi_branch',
      'public.branch_selection',
      'public.explicit_branch_code',
      'public.booking_flow_smoke',
      'public.customer_notifications',
    ]) {
      expect(svc).toContain(key);
    }
  });

  it('shared receipt/whatsapp identity helpers avoid GLEEM leakage', () => {
    const r = read('src/lib/branch/branchReceiptIdentity.ts');
    expect(r).toContain('buildMockBranchReceiptPayload');
    expect(r).toContain('containsGleemName');
    expect(r).toContain('productionPrintJobs');
    expect(r).toContain('realSends');
  });

  it('docs and apply/smoke/verifier scripts exist', () => {
    for (const rel of [
      'docs/branch-phase-1o-camp-caesar-real-config-audit.md',
      'docs/branch-phase-1o-booking-employee-handoff.md',
      'docs/branch-phase-1o-closure.md',
      'scripts/branch-smoke/apply-phase1o-camp-caesar-config.ts',
      'scripts/branch-smoke/run-phase1o-focused-smoke.ts',
      'scripts/verify-camp-caesar-real-configuration.ts',
    ]) {
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }
  });
});
