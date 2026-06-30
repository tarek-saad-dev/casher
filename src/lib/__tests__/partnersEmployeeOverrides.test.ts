import { describe, it, expect } from 'vitest';
import {
  TAREK_EMP_ID,
  ZIAD_EMP_ID,
  applyEmployeePartnerOverride,
  DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES,
  getEmployeePartnerOverrideFromMap,
} from '@/lib/reports/partnersEmployeeOverrides';

const JUNE_OVERRIDES = DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES['2026-06'];

describe('applyEmployeePartnerOverride', () => {
  it('applies June 2026 overrides for Ziad and Tarek', () => {
    const ziad = applyEmployeePartnerOverride({
      override: JUNE_OVERRIDES[ZIAD_EMP_ID],
      actualRevenue: 15000,
      paidSalaryOrAdvance: 5000,
      isServiceWorker: true,
    });
    expect(ziad.shopRevenue).toBe(0);
    expect(ziad.paidSalaryAndAdvances).toBe(0);
    expect(ziad.hasSpecialAccounting).toBe(true);

    const tarek = applyEmployeePartnerOverride({
      override: JUNE_OVERRIDES[TAREK_EMP_ID],
      actualRevenue: 0,
      paidSalaryOrAdvance: 3000,
      isServiceWorker: false,
    });
    expect(tarek.shopRevenue).toBe(0);
    expect(tarek.paidSalaryAndAdvances).toBe(0);
    expect(tarek.hasSpecialAccounting).toBe(true);
  });

  it('leaves other employees unchanged when no override exists', () => {
    const result = applyEmployeePartnerOverride({
      actualRevenue: 1200,
      paidSalaryOrAdvance: 800,
      isServiceWorker: true,
    });
    expect(result.shopRevenue).toBe(1200);
    expect(result.paidSalaryAndAdvances).toBe(800);
    expect(result.hasSpecialAccounting).toBe(false);
  });

  it('applies only salary override without replacing revenue', () => {
    const result = applyEmployeePartnerOverride({
      override: { paidSalaryOrAdvance: 100 },
      actualRevenue: 4000,
      paidSalaryOrAdvance: 1000,
      isServiceWorker: true,
    });

    expect(result.shopRevenue).toBe(4000);
    expect(result.paidSalaryAndAdvances).toBe(100);
    expect(result.hasSpecialAccounting).toBe(true);
  });

  it('keeps explicit zero override values', () => {
    const result = applyEmployeePartnerOverride({
      override: JUNE_OVERRIDES[ZIAD_EMP_ID],
      actualRevenue: 99999,
      paidSalaryOrAdvance: 88888,
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
        isServiceWorker: true,
      }),
      applyEmployeePartnerOverride({
        actualRevenue: 1000,
        paidSalaryOrAdvance: 500,
        isServiceWorker: true,
      }),
    ];

    const totalShop = rows.reduce((sum, row) => sum + (row.shopRevenue ?? 0), 0);
    const totalPaid = rows.reduce((sum, row) => sum + row.paidSalaryAndAdvances, 0);

    expect(totalShop).toBe(1000);
    expect(totalPaid).toBe(500);
  });
});
