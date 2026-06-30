import { roundMoney } from '@/lib/reportMonthUtils';

export type EmployeeMonthlyOverride = {
  actualRevenue?: number;
  paidSalaryOrAdvance?: number;
  note?: string;
};

export type PartnersOverridesMap = Record<string, Record<number, EmployeeMonthlyOverride>>;

/** Stable employee IDs — names may change in TblEmp. */
export const ZIAD_EMP_ID = 12;
export const TAREK_EMP_ID = 22;

/** Default special-case employees shown as quick presets on the admin page. */
export const PARTNERS_OVERRIDE_PRESET_EMPLOYEES = [
  { employeeId: ZIAD_EMP_ID, label: 'زياد' },
  { employeeId: TAREK_EMP_ID, label: 'طارق' },
] as const;

export const DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES: PartnersOverridesMap = {
  '2026-06': {
    [ZIAD_EMP_ID]: {
      actualRevenue: 0,
      paidSalaryOrAdvance: 0,
      note: 'حساب خاص مؤقت لزياد',
    },
    [TAREK_EMP_ID]: {
      actualRevenue: 0,
      paidSalaryOrAdvance: 0,
      note: 'حساب خاص مؤقت لطارق',
    },
  },
};

export function getPartnersMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getEmployeePartnerOverrideFromMap(
  overrides: PartnersOverridesMap,
  employeeId: number,
  year: number,
  month: number
): EmployeeMonthlyOverride | undefined {
  const monthKey = getPartnersMonthKey(year, month);
  return overrides[monthKey]?.[employeeId];
}

export function getOverrideEmployeeIdsFromMap(
  overrides: PartnersOverridesMap,
  year: number,
  month: number
): number[] {
  const monthKey = getPartnersMonthKey(year, month);
  const monthOverrides = overrides[monthKey];
  if (!monthOverrides) return [];
  return Object.keys(monthOverrides).map((id) => Number(id));
}

export function applyEmployeePartnerOverride(params: {
  override?: EmployeeMonthlyOverride;
  actualRevenue: number | null;
  paidSalaryOrAdvance: number;
  isServiceWorker: boolean;
}): {
  shopRevenue: number | null;
  paidSalaryAndAdvances: number;
  hasSpecialAccounting: boolean;
} {
  const override = params.override;
  const hasSpecialAccounting = override != null;
  const hasExplicitRevenueOverride = override?.actualRevenue !== undefined;

  const paidSalaryAndAdvances = roundMoney(
    override?.paidSalaryOrAdvance !== undefined
      ? override.paidSalaryOrAdvance
      : params.paidSalaryOrAdvance
  );

  let shopRevenue: number | null;
  if (hasExplicitRevenueOverride) {
    shopRevenue = roundMoney(override!.actualRevenue!);
  } else if (params.isServiceWorker) {
    shopRevenue = roundMoney(params.actualRevenue ?? 0);
  } else {
    shopRevenue = null;
  }

  return {
    shopRevenue,
    paidSalaryAndAdvances,
    hasSpecialAccounting,
  };
}
