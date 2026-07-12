import { describe, expect, it } from 'vitest';
import {
  mapEmploymentTypeForBackfill,
  mapPayrollMethodForBackfill,
  isFreelanceMonthlyBlocked,
  isValidEmploymentType,
  isValidPayrollMethod,
  PHASE1_TBL_EMP_COLUMNS,
  PHASE1_PRESERVED_TBL_EMP_COLUMNS,
} from '@/lib/migrations/employeeHrModelPhase1';

describe('employeeHrModelPhase1 backfill mapping', () => {
  describe('mapEmploymentTypeForBackfill', () => {
    it('maps IsAttendanceExempt=1 to freelance', () => {
      expect(
        mapEmploymentTypeForBackfill({ isAttendanceExempt: true, workingDayCount: 6 }),
      ).toBe('freelance');
    });

    it('maps 6 working days to full_time', () => {
      expect(
        mapEmploymentTypeForBackfill({ isAttendanceExempt: false, workingDayCount: 6 }),
      ).toBe('full_time');
    });

    it('maps 1-5 working days to part_time', () => {
      for (const n of [1, 2, 3, 4, 5]) {
        expect(
          mapEmploymentTypeForBackfill({ isAttendanceExempt: false, workingDayCount: n }),
        ).toBe('part_time');
      }
    });

    it('defaults to full_time when no schedule rows (null workingDayCount)', () => {
      expect(
        mapEmploymentTypeForBackfill({ isAttendanceExempt: false, workingDayCount: null }),
      ).toBe('full_time');
    });

    it('defaults to full_time for 0 working days', () => {
      expect(
        mapEmploymentTypeForBackfill({ isAttendanceExempt: false, workingDayCount: 0 }),
      ).toBe('full_time');
    });

    it('defaults to full_time for 7 working days (not exactly 6)', () => {
      expect(
        mapEmploymentTypeForBackfill({ isAttendanceExempt: false, workingDayCount: 7 }),
      ).toBe('full_time');
    });
  });

  describe('mapPayrollMethodForBackfill', () => {
    it('maps SalaryType monthly to monthly', () => {
      expect(mapPayrollMethodForBackfill('monthly')).toBe('monthly');
      expect(mapPayrollMethodForBackfill('Monthly')).toBe('monthly');
    });

    it('maps SalaryType Daily/daily to hourly (legacy daily payroll uses hourly math)', () => {
      expect(mapPayrollMethodForBackfill('Daily')).toBe('hourly');
      expect(mapPayrollMethodForBackfill('daily')).toBe('hourly');
    });

    it('maps SalaryType hourly to hourly', () => {
      expect(mapPayrollMethodForBackfill('hourly')).toBe('hourly');
    });

    it('defaults unknown SalaryType to hourly', () => {
      expect(mapPayrollMethodForBackfill(null)).toBe('hourly');
      expect(mapPayrollMethodForBackfill('')).toBe('hourly');
      expect(mapPayrollMethodForBackfill('commission')).toBe('hourly');
    });

    it('maps payroll-disabled employees the same way (method still valid)', () => {
      expect(mapPayrollMethodForBackfill('monthly')).toBe('monthly');
    });
  });

  describe('isFreelanceMonthlyBlocked', () => {
    it('blocks freelance + monthly', () => {
      expect(isFreelanceMonthlyBlocked('freelance', 'monthly')).toBe(true);
    });

    it('allows freelance + hourly and freelance + daily', () => {
      expect(isFreelanceMonthlyBlocked('freelance', 'hourly')).toBe(false);
      expect(isFreelanceMonthlyBlocked('freelance', 'daily')).toBe(false);
    });

    it('allows null combinations (Phase 1 nullable columns pass CHECK)', () => {
      expect(isFreelanceMonthlyBlocked(null, 'monthly')).toBe(false);
      expect(isFreelanceMonthlyBlocked('freelance', null)).toBe(false);
    });
  });

  describe('validation helpers', () => {
    it('accepts valid employment types and payroll methods', () => {
      expect(isValidEmploymentType('full_time')).toBe(true);
      expect(isValidEmploymentType('part_time')).toBe(true);
      expect(isValidEmploymentType('freelance')).toBe(true);
      expect(isValidPayrollMethod('hourly')).toBe(true);
      expect(isValidPayrollMethod('daily')).toBe(true);
      expect(isValidPayrollMethod('monthly')).toBe(true);
    });

    it('rejects invalid values', () => {
      expect(isValidEmploymentType('contract')).toBe(false);
      expect(isValidPayrollMethod('weekly')).toBe(false);
    });
  });

  describe('Phase 1 scope guards', () => {
    it('adds expected new columns only', () => {
      expect(PHASE1_TBL_EMP_COLUMNS).toEqual([
        'EmploymentType',
        'PayrollMethod',
        'DailyRate',
        'ManualHourlyRate',
      ]);
    });

    it('preserves legacy columns (no drop/rename in Phase 1)', () => {
      expect(PHASE1_PRESERVED_TBL_EMP_COLUMNS).toContain('SalaryType');
      expect(PHASE1_PRESERVED_TBL_EMP_COLUMNS).toContain('HourlyRate');
      expect(PHASE1_PRESERVED_TBL_EMP_COLUMNS).toContain('IsPayrollEnabled');
    });

    it('does not touch cash or ledger tables in Phase 1', () => {
      const phase1Tables: string[] = ['TblEmp'];
      expect(phase1Tables).not.toContain('TblCashMove');
      expect(phase1Tables).not.toContain('TblEmpLedgerEntry');
      expect(phase1Tables).not.toContain('TblEmpDailyPayroll');
      expect(phase1Tables).not.toContain('TblEmpAttendance');
    });
  });
});
