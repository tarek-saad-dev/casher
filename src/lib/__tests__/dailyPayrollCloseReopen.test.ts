/**
 * Phase 4 — Close / reopen daily payroll (BranchID + WorkDate).
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  planCloseWhenReadinessReady,
  planEmpBranchWorkDayCloseTransition,
  PAYROLL_DAY_CLOSED_CODE,
  PAYROLL_DAY_CLOSED_MESSAGE,
  canTransitionEmpBranchWorkDayClose,
} from '@/lib/hr/empBranchWorkDayClose.transitions';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { recommendCloseState } from '@/lib/hr/dailyPayrollReadiness.recommend';

const root = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Phase 4 close/reopen transition rules', () => {
  it('READY_TO_CLOSE → CLOSED via classic transition', () => {
    expect(canTransitionEmpBranchWorkDayClose('READY_TO_CLOSE', 'CLOSED')).toBe(true);
    const patch = planEmpBranchWorkDayCloseTransition({
      from: 'READY_TO_CLOSE',
      to: 'CLOSED',
      actorUserId: 9,
    });
    expect(patch.state).toBe('CLOSED');
    expect(patch.closedAt).toBe('now');
    expect(patch.closedByUserId).toBe(9);
  });

  it('OPEN / NEEDS_REVIEW cannot close via classic transition matrix', () => {
    expect(canTransitionEmpBranchWorkDayClose('OPEN', 'CLOSED')).toBe(false);
    expect(canTransitionEmpBranchWorkDayClose('NEEDS_REVIEW', 'CLOSED')).toBe(false);
    expect(() =>
      planEmpBranchWorkDayCloseTransition({
        from: 'OPEN',
        to: 'CLOSED',
        actorUserId: 1,
      }),
    ).toThrow(EmpBranchWorkDayCloseError);
  });

  it('planCloseWhenReadinessReady rejects when readiness not verified', () => {
    expect(() =>
      planCloseWhenReadinessReady({
        from: 'OPEN',
        actorUserId: 1,
        readinessVerified: false,
      }),
    ).toThrow(/غير جاهز/);
    try {
      planCloseWhenReadinessReady({
        from: 'NEEDS_REVIEW',
        actorUserId: 1,
        readinessVerified: false,
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EmpBranchWorkDayCloseError);
      expect((e as EmpBranchWorkDayCloseError).code).toBe('NOT_READY_TO_CLOSE');
    }
  });

  it('planCloseWhenReadinessReady allows OPEN→CLOSED when readiness verified (server re-check path)', () => {
    const patch = planCloseWhenReadinessReady({
      from: 'OPEN',
      actorUserId: 3,
      readinessVerified: true,
    });
    expect(patch.state).toBe('CLOSED');
    expect(patch.closedByUserId).toBe(3);
    expect(patch.closedAt).toBe('now');
  });

  it('duplicate close rejected with PAYROLL_DAY_CLOSED', () => {
    try {
      planCloseWhenReadinessReady({
        from: 'CLOSED',
        actorUserId: 1,
        readinessVerified: true,
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EmpBranchWorkDayCloseError);
      expect((e as EmpBranchWorkDayCloseError).code).toBe(PAYROLL_DAY_CLOSED_CODE);
    }
  });

  it('reopen requires reason + permission fields', () => {
    expect(() =>
      planEmpBranchWorkDayCloseTransition({
        from: 'CLOSED',
        to: 'REOPENED',
        actorUserId: 2,
        reopenReason: '',
      }),
    ).toThrow(/سبب/);

    const patch = planEmpBranchWorkDayCloseTransition({
      from: 'CLOSED',
      to: 'REOPENED',
      actorUserId: 2,
      reopenReason: 'تصحيح ساعات',
    });
    expect(patch.state).toBe('REOPENED');
    expect(patch.reopenReason).toBe('تصحيح ساعات');
    expect(patch.reopenedByUserId).toBe(2);
    expect(patch.reopenedAt).toBe('now');
    expect(patch.closedAt).toBe('keep');
  });

  it('CLOSED → REOPENED → READY path does not auto-close', () => {
    expect(canTransitionEmpBranchWorkDayClose('CLOSED', 'REOPENED')).toBe(true);
    expect(canTransitionEmpBranchWorkDayClose('REOPENED', 'CLOSED')).toBe(false);
    expect(
      recommendCloseState({
        persistedState: 'REOPENED',
        blockerCount: 0,
        hasActivity: true,
        allRequiredComplete: true,
      }),
    ).toBe('READY_TO_CLOSE');
    // Persisted stays REOPENED until explicit close mutation
    expect(
      recommendCloseState({
        persistedState: 'CLOSED',
        blockerCount: 0,
        hasActivity: true,
        allRequiredComplete: true,
      }),
    ).toBe('CLOSED');
  });

  it('exports PAYROLL_DAY_CLOSED code/message for mutation guards', () => {
    expect(PAYROLL_DAY_CLOSED_CODE).toBe('PAYROLL_DAY_CLOSED');
    expect(PAYROLL_DAY_CLOSED_MESSAGE).toMatch(/مقفل/);
  });
});

describe('Phase 4 close service SQL concurrency + isolation', () => {
  const svc = read('src/lib/hr/empBranchWorkDayClose.service.ts');
  const closeSvc = read('src/lib/hr/dailyPayrollClose.service.ts');
  const openDays = read('src/lib/hr/dailyPayrollReadiness.service.ts');

  it('close re-runs readiness then persists atomically', () => {
    expect(closeSvc).toContain('evaluateDailyPayrollReadiness');
    expect(closeSvc).toContain('persistEmpBranchWorkDayClosed');
    expect(closeSvc).toContain('NOT_READY_TO_CLOSE');
    expect(closeSvc).toContain("recommendedState !== 'READY_TO_CLOSE'");
  });

  it('concurrent close guarded by unique insert + State <> CLOSED update', () => {
    expect(svc).toContain("State <> N'CLOSED'");
    expect(svc).toMatch(/unique\|duplicate\|2627\|2601/i);
    expect(svc).toContain(PAYROLL_DAY_CLOSED_CODE);
  });

  it('GLEEM/Camp isolation: unique is (BranchID, WorkDate) not WorkDate alone', () => {
    const mig = read('db/migrations/create-tbl-emp-branch-workday-close.sql');
    expect(mig).toContain('UNIQUE ([BranchID], [WorkDate])');
    expect(mig).not.toContain('UNIQUE ([WorkDate])');
    expect(svc).toContain('BranchID, WorkDate');
  });

  it('open-days excludes CLOSED and keeps REOPENED', () => {
    expect(openDays).toContain("state !== 'CLOSED'");
    expect(openDays).toMatch(/CLOSED persisted states are excluded/);
  });

  it('does not touch TblNewDay or /api/day/close or post-to-cash', () => {
    expect(closeSvc).not.toMatch(/TblNewDay|\/api\/day\/close|post-to-cash/);
    expect(svc).not.toMatch(/TblNewDay|post-to-cash/);
  });
});

describe('Phase 4 CLOSED mutation guards', () => {
  it('blocks payroll generate, target generate, attendance, wage/target ledger mutate', () => {
    const dual = read('src/lib/services/employeeLedgerDualWrite.ts');
    const tgt = read('src/lib/payroll/employee-target/employee-daily-target-generation.service.ts');
    const ledgerQ = read(
      'src/lib/payroll/employee-target/employee-daily-target-ledger-query.service.ts',
    );
    const bulk = read('src/app/api/admin/attendance/bulk/route.ts');
    const genRoute = read('src/app/api/payroll/daily/generate/route.ts');
    const tgtRoute = read('src/app/api/payroll/daily/targets/generate/route.ts');

    expect(dual).toContain('assertEmpBranchWorkDayMutable');
    expect(tgt).toContain('assertEmpBranchWorkDayMutable');
    expect(ledgerQ).toContain('assertEmpBranchWorkDayMutable');
    expect(ledgerQ).toContain('if (!body.dryRun)');
    expect(read('src/modules/attendance/application/AttendanceCommandService.ts')).toContain(
      'assertEmpBranchWorkDayMutable',
    );
    expect(bulk).toContain('saveAdminAttendanceBulk');
    expect(genRoute).toContain('isEmpBranchWorkDayCloseError');
    expect(tgtRoute).toContain('isEmpBranchWorkDayCloseError');
  });

  it('does not guard employee ledger payout/advance cash APIs', () => {
    const ledgerRoot = path.join(root, 'src/app/api/admin/hr/employee-ledger');
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (f.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf8');
          expect(src).not.toContain('assertEmpBranchWorkDayMutable');
        }
      }
    };
    walk(ledgerRoot);
  });

  it('UI shows close only when READY_TO_CLOSE and reopen for admin', () => {
    const panel = read('src/components/hr/DailyPayrollPanel.tsx');
    expect(panel).toContain('إقفال يوم الموظفين');
    expect(panel).toContain('إعادة فتح اليوم');
    expect(panel).toContain('canCloseDay');
    expect(panel).toContain('canReopenPayrollDay');
    expect(panel).toContain('/api/admin/hr/daily-payroll/close');
    expect(panel).toContain('/api/admin/hr/daily-payroll/reopen');
  });
});

describe('Phase 4 reopen API admin guard', () => {
  it('reopen route uses requireAdmin + mandatory reason', () => {
    const route = read('src/app/api/admin/hr/daily-payroll/reopen/route.ts');
    expect(route).toContain('requireAdmin');
    expect(route).toContain('reopenReason');
    expect(route).toContain('REOPEN_REASON_REQUIRED');
  });

  it('close route revalidates readiness via closeEmpBranchWorkDay', () => {
    const route = read('src/app/api/admin/hr/daily-payroll/close/route.ts');
    expect(route).toContain('closeEmpBranchWorkDay');
    expect(route).toContain('requirePageAccess');
  });
});
