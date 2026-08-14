import { describe, expect, it } from 'vitest';
import {
  employeeStatusFromReadiness,
  openDayChipLabel,
  summarizeOpenDays,
} from '@/lib/hr/dailyPayrollClosingUi';
import type { DailyPayrollOpenDayItem } from '@/lib/hr/dailyPayrollReadiness.types';

describe('dailyPayrollClosingUi', () => {
  it('maps readiness blockers to الحالة labels', () => {
    expect(
      employeeStatusFromReadiness({
        empId: 1,
        empName: 'أ',
        ready: true,
        blockers: [],
        hasAttendance: true,
        hasOpenSession: false,
        payrollGenerated: true,
        targetGenerated: true,
        payrollLedgerOk: true,
        targetSyncStatus: 'up_to_date',
      }).label,
    ).toBe('جاهز');

    expect(
      employeeStatusFromReadiness({
        empId: 1,
        empName: 'أ',
        ready: false,
        blockers: ['missing_check_out'],
        hasAttendance: true,
        hasOpenSession: false,
        payrollGenerated: false,
        targetGenerated: false,
        payrollLedgerOk: null,
        targetSyncStatus: 'none',
      }).label,
    ).toBe('ناقص انصراف');
  });

  it('formats open-day chips and summary without inventing readiness', () => {
    const items: DailyPayrollOpenDayItem[] = [
      {
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        workDate: '2026-08-11',
        persistedState: 'OPEN',
        recommendedState: 'NEEDS_REVIEW',
        readyToClose: false,
        blockerCount: 3,
        readyEmployeeCount: 0,
        employeeCount: 5,
        shortBlockerSummary: 'x',
      },
      {
        branchId: 3,
        branchCode: 'CAMP_CAESAR',
        branchName: 'كامب شيزار',
        workDate: '2026-08-11',
        persistedState: 'OPEN',
        recommendedState: 'READY_TO_CLOSE',
        readyToClose: true,
        blockerCount: 0,
        readyEmployeeCount: 2,
        employeeCount: 2,
        shortBlockerSummary: 'جاهز',
      },
    ];
    expect(openDayChipLabel(items[0])).toContain('⚠ 3 مشاكل');
    expect(openDayChipLabel(items[1])).toContain('✓ جاهز');
    const s = summarizeOpenDays(items);
    expect(s.openCount).toBe(2);
    expect(s.readyCount).toBe(1);
    expect(s.reviewCount).toBe(1);
    expect(s.oldest?.branchCode).toBe('GLEEM');
  });
});
