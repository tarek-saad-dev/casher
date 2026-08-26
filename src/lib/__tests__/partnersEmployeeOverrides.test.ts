import { describe, it, expect } from 'vitest';
import {
  TAREK_EMP_ID,
  ZIAD_EMP_ID,
  applyEmployeePartnerOverride,
  applyFieldAdjust,
  DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES,
  getEmployeePartnerOverrideFromMap,
  normalizeFieldAdjust,
  parsePartnersOverridesFile,
  resolveOverridesForBranch,
  upsertBranchMonthOverrides,
} from '@/lib/reports/partnersEmployeeOverrides';
import { partnersEmployeePaidTotal } from '@/components/reports/partners/partnersReportUtils';

const JUNE_OVERRIDES = DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES['2026-06'];

describe('applyFieldAdjust', () => {
  it('keeps live value when no adjust', () => {
    expect(applyFieldAdjust(10000, undefined)).toEqual({ value: 10000, applied: false });
  });

  it('applies static replacement', () => {
    expect(applyFieldAdjust(10000, { mode: 'static', value: 8500 })).toEqual({
      value: 8500,
      applied: true,
    });
  });

  it('subtracts a percentage from live', () => {
    expect(applyFieldAdjust(10000, { mode: 'subtract_pct', value: 10 })).toEqual({
      value: 9000,
      applied: true,
    });
  });

  it('keeps a percentage of live', () => {
    expect(applyFieldAdjust(10000, { mode: 'keep_pct', value: 90 })).toEqual({
      value: 9000,
      applied: true,
    });
  });

  it('subtracts a fixed amount from live', () => {
    expect(applyFieldAdjust(10000, { mode: 'subtract_amt', value: 3000 })).toEqual({
      value: 7000,
      applied: true,
    });
  });

  it('adds amount and percent', () => {
    expect(applyFieldAdjust(10000, { mode: 'add_amt', value: 500 })).toEqual({
      value: 10500,
      applied: true,
    });
    expect(applyFieldAdjust(10000, { mode: 'add_pct', value: 10 })).toEqual({
      value: 11000,
      applied: true,
    });
  });

  it('floors derived results at zero', () => {
    expect(applyFieldAdjust(2000, { mode: 'subtract_amt', value: 5000 }).value).toBe(0);
  });

  it('treats legacy bare numbers as static', () => {
    expect(normalizeFieldAdjust(1234)).toEqual({ mode: 'static', value: 1234 });
    expect(applyFieldAdjust(9999, 1234)).toEqual({ value: 1234, applied: true });
  });
});

describe('applyEmployeePartnerOverride', () => {
  it('applies June 2026 overrides for Ziad and Tarek', () => {
    const ziad = applyEmployeePartnerOverride({
      override: JUNE_OVERRIDES[ZIAD_EMP_ID],
      actualRevenue: 15000,
      paidSalaryOrAdvance: 5000,
      salaryAndTarget: 4000,
      advanceExcess: 1000,
      isServiceWorker: true,
    });
    expect(ziad.shopRevenue).toBe(0);
    expect(ziad.salaryAndTarget).toBe(0);
    expect(ziad.advanceExcess).toBe(0);
    expect(ziad.paidSalaryAndAdvances).toBe(0);
    expect(ziad.hasSpecialAccounting).toBe(true);

    const tarek = applyEmployeePartnerOverride({
      override: JUNE_OVERRIDES[TAREK_EMP_ID],
      actualRevenue: 0,
      paidSalaryOrAdvance: 3000,
      salaryAndTarget: 2500,
      advanceExcess: 500,
      isServiceWorker: false,
    });
    expect(tarek.shopRevenue).toBe(0);
    expect(tarek.salaryAndTarget).toBe(0);
    expect(tarek.advanceExcess).toBe(0);
    expect(tarek.paidSalaryAndAdvances).toBe(0);
    expect(tarek.hasSpecialAccounting).toBe(true);
  });

  it('leaves other employees unchanged when no override exists', () => {
    const result = applyEmployeePartnerOverride({
      actualRevenue: 1200,
      paidSalaryOrAdvance: 800,
      salaryAndTarget: 800,
      advanceExcess: 0,
      isServiceWorker: true,
    });
    expect(result.shopRevenue).toBe(1200);
    expect(result.salaryAndTarget).toBe(800);
    expect(result.advanceExcess).toBe(0);
    expect(result.paidSalaryAndAdvances).toBe(800);
    expect(result.hasSpecialAccounting).toBe(false);
  });

  it('applies percent and amount adjusts independently per field', () => {
    const result = applyEmployeePartnerOverride({
      override: {
        actualRevenue: { mode: 'subtract_pct', value: 10 },
        salaryAndTarget: { mode: 'subtract_amt', value: 3000 },
        advanceExcess: { mode: 'static', value: 100 },
      },
      actualRevenue: 10000,
      salaryAndTarget: 8000,
      advanceExcess: 900,
      isServiceWorker: true,
    });

    expect(result.shopRevenue).toBe(9000);
    expect(result.salaryAndTarget).toBe(5000);
    expect(result.advanceExcess).toBe(100);
    expect(result.paidSalaryAndAdvances).toBe(5100);
    expect(result.hasSpecialAccounting).toBe(true);
  });

  it('maps legacy paidSalaryOrAdvance to salary and zeroes advances', () => {
    const result = applyEmployeePartnerOverride({
      override: { paidSalaryOrAdvance: 100 },
      actualRevenue: 4000,
      salaryAndTarget: 3000,
      advanceExcess: 900,
      isServiceWorker: true,
    });

    expect(result.shopRevenue).toBe(4000);
    expect(result.salaryAndTarget).toBe(100);
    expect(result.advanceExcess).toBe(0);
    expect(result.paidSalaryAndAdvances).toBe(100);
  });

  it('keeps explicit zero override values', () => {
    const result = applyEmployeePartnerOverride({
      override: JUNE_OVERRIDES[ZIAD_EMP_ID],
      actualRevenue: 99999,
      paidSalaryOrAdvance: 88888,
      salaryAndTarget: 77777,
      advanceExcess: 66666,
      isServiceWorker: true,
    });
    expect(result.shopRevenue).toBe(0);
    expect(result.paidSalaryAndAdvances).toBe(0);
  });

  it('does not reuse June overrides in July', () => {
    const result = applyEmployeePartnerOverride({
      override: getEmployeePartnerOverrideFromMap(
        DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES,
        ZIAD_EMP_ID,
        2026,
        7
      ),
      actualRevenue: 2500,
      paidSalaryOrAdvance: 1200,
      salaryAndTarget: 1200,
      advanceExcess: 0,
      isServiceWorker: true,
    });
    expect(result.hasSpecialAccounting).toBe(false);
    expect(result.shopRevenue).toBe(2500);
    expect(result.paidSalaryAndAdvances).toBe(1200);
  });

  it('shows revenue for non-barber when actualRevenue override is explicit', () => {
    const result = applyEmployeePartnerOverride({
      override: JUNE_OVERRIDES[TAREK_EMP_ID],
      actualRevenue: null,
      paidSalaryOrAdvance: 5000,
      salaryAndTarget: 5000,
      advanceExcess: 0,
      isServiceWorker: false,
    });
    expect(result.shopRevenue).toBe(0);
  });
});

describe('totals from final rows', () => {
  it('sums final overridden values for totals row', () => {
    const rows = [
      applyEmployeePartnerOverride({
        override: JUNE_OVERRIDES[ZIAD_EMP_ID],
        actualRevenue: 45465.57,
        paidSalaryOrAdvance: 90803,
        salaryAndTarget: 80000,
        advanceExcess: 10803,
        isServiceWorker: true,
      }),
      applyEmployeePartnerOverride({
        actualRevenue: 1000,
        paidSalaryOrAdvance: 500,
        salaryAndTarget: 400,
        advanceExcess: 100,
        isServiceWorker: true,
      }),
    ];

    const totalShop = rows.reduce((sum, row) => sum + (row.shopRevenue ?? 0), 0);
    const totalPaid = rows.reduce((sum, row) => sum + row.paidSalaryAndAdvances, 0);

    expect(totalShop).toBe(1000);
    expect(totalPaid).toBe(500);
  });
});

describe('partnersEmployeePaidTotal', () => {
  it('uses salary + advances when present so report math stays connected', () => {
    expect(
      partnersEmployeePaidTotal({
        totalPaidSalaryAndAdvances: 10,
        totalSalaryAndTarget: 80,
        totalAdvanceExcess: 20,
      })
    ).toBe(100);
  });
});

describe('branch-scoped override file', () => {
  it('keeps v1 months as GLEEM-only legacy data', () => {
    const file = parsePartnersOverridesFile({
      '2026-06': {
        '12': { actualRevenue: 1, paidSalaryOrAdvance: 2 },
      },
    });

    const gleem = resolveOverridesForBranch(file, 1, 'GLEEM');
    const camp = resolveOverridesForBranch(file, 3, 'CAMP_CAESAR');

    expect(normalizeFieldAdjust(gleem['2026-06'][12]?.actualRevenue)).toEqual({
      mode: 'static',
      value: 1,
    });
    expect(camp['2026-06']).toBeUndefined();
  });

  it('stores each branch month independently with adjust objects', () => {
    const empty = parsePartnersOverridesFile({ version: 2, branches: {} });
    const afterCamp = upsertBranchMonthOverrides(
      empty,
      3,
      'CAMP_CAESAR',
      '2026-08',
      {
        12: {
          salaryAndTarget: { mode: 'subtract_pct', value: 10 },
          advanceExcess: { mode: 'subtract_amt', value: 50 },
        },
      }
    );

    const camp = resolveOverridesForBranch(afterCamp, 3, 'CAMP_CAESAR')['2026-08'][12];
    expect(camp?.salaryAndTarget).toEqual({ mode: 'subtract_pct', value: 10 });
    expect(resolveOverridesForBranch(afterCamp, 1, 'GLEEM')['2026-08']).toBeUndefined();
  });
});
