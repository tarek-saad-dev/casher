/**
 * Phase 1 — Branch workday closing foundation (pure rules + schema contract).
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  canTransitionEmpBranchWorkDayClose,
  EMP_BRANCH_WORKDAY_CLOSE_TRANSITIONS,
  planEmpBranchWorkDayCloseTransition,
  validateWorkDateYmd,
} from '@/lib/hr/empBranchWorkDayClose.transitions';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { EMP_BRANCH_WORKDAY_CLOSE_STATES } from '@/lib/hr/empBranchWorkDayClose.types';

const root = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('TblEmpBranchWorkDayClose migration', () => {
  const sql = read('db/migrations/create-tbl-emp-branch-workday-close.sql');

  it('creates unique (BranchID, WorkDate) and state check', () => {
    expect(sql).toContain('TblEmpBranchWorkDayClose');
    expect(sql).toContain('UQ_TblEmpBranchWorkDayClose_Branch_WorkDate');
    expect(sql).toContain('UNIQUE ([BranchID], [WorkDate])');
    expect(sql).toContain("N'OPEN'");
    expect(sql).toContain("N'NEEDS_REVIEW'");
    expect(sql).toContain("N'READY_TO_CLOSE'");
    expect(sql).toContain("N'CLOSED'");
    expect(sql).toContain("N'REOPENED'");
    expect(sql).toContain('ClosedAt');
    expect(sql).toContain('ClosedByUserID');
    expect(sql).toContain('ReopenedAt');
    expect(sql).toContain('ReopenedByUserID');
    expect(sql).toContain('ReopenReason');
    expect(sql).toContain('CreatedAt');
    expect(sql).toContain('UpdatedAt');
  });

  it('does not touch payroll Status or TblNewDay', () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+.*TblEmpDailyPayroll/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+.*TblNewDay/i);
    expect(sql).toMatch(/Does NOT alter TblEmpDailyPayroll\.Status or TblNewDay/);
  });
});

describe('empBranchWorkDayClose transitions', () => {
  it('exposes all five states', () => {
    expect([...EMP_BRANCH_WORKDAY_CLOSE_STATES]).toEqual([
      'OPEN',
      'NEEDS_REVIEW',
      'READY_TO_CLOSE',
      'CLOSED',
      'REOPENED',
    ]);
  });

  it('GLEEM and Camp same date are independent at grain level', () => {
    // Unique is (BranchID, WorkDate) — same WorkDate allowed on two branches.
    const mig = read('db/migrations/create-tbl-emp-branch-workday-close.sql');
    expect(mig).toContain('UNIQUE ([BranchID], [WorkDate])');
    expect(mig).not.toContain('UNIQUE ([WorkDate])');
  });

  it('allows OPEN → NEEDS_REVIEW / READY_TO_CLOSE only', () => {
    expect(canTransitionEmpBranchWorkDayClose('OPEN', 'NEEDS_REVIEW')).toBe(true);
    expect(canTransitionEmpBranchWorkDayClose('OPEN', 'READY_TO_CLOSE')).toBe(true);
    expect(canTransitionEmpBranchWorkDayClose('OPEN', 'CLOSED')).toBe(false);
    expect(canTransitionEmpBranchWorkDayClose('OPEN', 'REOPENED')).toBe(false);
    expect(canTransitionEmpBranchWorkDayClose('OPEN', 'OPEN')).toBe(false);
  });

  it('CLOSED only transitions to REOPENED', () => {
    expect([...EMP_BRANCH_WORKDAY_CLOSE_TRANSITIONS.CLOSED]).toEqual(['REOPENED']);
    expect(canTransitionEmpBranchWorkDayClose('CLOSED', 'OPEN')).toBe(false);
    expect(canTransitionEmpBranchWorkDayClose('CLOSED', 'READY_TO_CLOSE')).toBe(false);
  });

  it('rejects invalid transitions', () => {
    expect(() =>
      planEmpBranchWorkDayCloseTransition({
        from: 'OPEN',
        to: 'CLOSED',
        actorUserId: 1,
      }),
    ).toThrow(EmpBranchWorkDayCloseError);

    try {
      planEmpBranchWorkDayCloseTransition({
        from: 'CLOSED',
        to: 'READY_TO_CLOSE',
        actorUserId: 1,
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EmpBranchWorkDayCloseError);
      expect((e as EmpBranchWorkDayCloseError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('CLOSED records close audit metadata', () => {
    const patch = planEmpBranchWorkDayCloseTransition({
      from: 'READY_TO_CLOSE',
      to: 'CLOSED',
      actorUserId: 42,
    });
    expect(patch.state).toBe('CLOSED');
    expect(patch.closedAt).toBe('now');
    expect(patch.closedByUserId).toBe(42);
  });

  it('REOPENED requires reason + audit', () => {
    expect(() =>
      planEmpBranchWorkDayCloseTransition({
        from: 'CLOSED',
        to: 'REOPENED',
        actorUserId: 7,
        reopenReason: '   ',
      }),
    ).toThrow(/سبب إعادة الفتح/);

    const patch = planEmpBranchWorkDayCloseTransition({
      from: 'CLOSED',
      to: 'REOPENED',
      actorUserId: 7,
      reopenReason: 'تصحيح حضور ناقص',
    });
    expect(patch.state).toBe('REOPENED');
    expect(patch.reopenedAt).toBe('now');
    expect(patch.reopenedByUserId).toBe(7);
    expect(patch.reopenReason).toBe('تصحيح حضور ناقص');
    expect(patch.closedAt).toBe('keep');
  });

  it('validates WorkDate YYYY-MM-DD', () => {
    expect(validateWorkDateYmd('2026-08-11')).toBeNull();
    expect(validateWorkDateYmd('2026-13-01')).not.toBeNull();
    expect(validateWorkDateYmd('08-11-2026')).not.toBeNull();
  });

  it('service does not hook generate/payroll formulas', () => {
    const svc = read('src/lib/hr/empBranchWorkDayClose.service.ts');
    expect(svc).toContain('getEmpBranchWorkDayCloseState');
    expect(svc).toContain('transitionEmpBranchWorkDayClose');
    expect(svc).not.toMatch(/executeDailyPayrollGenerate|dailyWage|commission/i);
    const core = read('src/lib/payroll/dailyPayrollGenerateCore.ts');
    expect(core).not.toContain('EmpBranchWorkDayClose');
    expect(core).not.toContain('TblEmpBranchWorkDayClose');
  });
});
