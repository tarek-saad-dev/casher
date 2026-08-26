import { roundMoney } from '@/lib/reportMonthUtils';

/** How a partners-report field is derived from the live system number. */
export const PARTNERS_FIELD_ADJUST_MODES = [
  'live',
  'static',
  'subtract_pct',
  'keep_pct',
  'subtract_amt',
  'add_amt',
  'add_pct',
] as const;

export type PartnersFieldAdjustMode = (typeof PARTNERS_FIELD_ADJUST_MODES)[number];

export type PartnersFieldAdjust = {
  mode: Exclude<PartnersFieldAdjustMode, 'live'>;
  value: number;
};

export type EmployeeMonthlyOverride = {
  /** دخل للمحل — number = legacy static */
  actualRevenue?: number | PartnersFieldAdjust;
  /** استلم راتب (راتب + تارجت) */
  salaryAndTarget?: number | PartnersFieldAdjust;
  /** سلف */
  advanceExcess?: number | PartnersFieldAdjust;
  /** @deprecated combined salary+advances; used only when the new fields are absent */
  paidSalaryOrAdvance?: number;
  note?: string;
};

export type PartnersOverridesMap = Record<string, Record<number, EmployeeMonthlyOverride>>;

export type PartnersOverridesFile = {
  version: 2;
  branches: Record<string, PartnersOverridesMap>;
  legacy: PartnersOverridesMap;
};

/** Stable employee IDs — names may change in TblEmp. */
export const ZIAD_EMP_ID = 12;
export const TAREK_EMP_ID = 22;

/** Legacy unscoped JSON months apply only to this branch. */
export const LEGACY_OVERRIDES_BRANCH_CODE = 'GLEEM';

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

export const PARTNERS_FIELD_ADJUST_MODE_LABELS: Record<PartnersFieldAdjustMode, string> = {
  live: 'من النظام (ديناميك)',
  static: 'رقم ثابت',
  subtract_pct: 'خصم نسبة % من الديناميك',
  keep_pct: 'إبقاء نسبة % من الديناميك',
  subtract_amt: 'خصم مبلغ ثابت من الديناميك',
  add_amt: 'إضافة مبلغ ثابت للديناميك',
  add_pct: 'إضافة نسبة % للديناميك',
};

export function getPartnersMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function moneyEquals(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

export function isPartnersFieldAdjustMode(value: unknown): value is PartnersFieldAdjustMode {
  return typeof value === 'string' && (PARTNERS_FIELD_ADJUST_MODES as readonly string[]).includes(value);
}

export function normalizeFieldAdjust(raw: unknown): PartnersFieldAdjust | undefined {
  if (raw == null || raw === '') return undefined;

  if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return { mode: 'static', value: n };
  }

  if (typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const mode = src.mode;
  if (!isPartnersFieldAdjustMode(mode) || mode === 'live') return undefined;
  const value = Number(src.value);
  if (!Number.isFinite(value)) return undefined;
  return { mode, value };
}

export function fieldAdjustIsActive(
  adjust: number | PartnersFieldAdjust | undefined
): adjust is number | PartnersFieldAdjust {
  return normalizeFieldAdjust(adjust) !== undefined;
}

/**
 * Apply an adjustment on top of the live system value.
 * Percent modes use `value` as a percentage (10 = 10%).
 * Result is floored at 0 for derived modes; static keeps the exact value (including 0).
 */
export function applyFieldAdjust(
  live: number | null | undefined,
  adjust: number | PartnersFieldAdjust | undefined
): { value: number; applied: boolean } {
  const rule = normalizeFieldAdjust(adjust);
  const base = live == null || !Number.isFinite(live) ? 0 : live;

  if (!rule) {
    return { value: roundMoney(base), applied: false };
  }

  let result: number;
  switch (rule.mode) {
    case 'static':
      result = rule.value;
      break;
    case 'subtract_pct':
      result = base - (base * rule.value) / 100;
      break;
    case 'keep_pct':
      result = (base * rule.value) / 100;
      break;
    case 'subtract_amt':
      result = base - rule.value;
      break;
    case 'add_amt':
      result = base + rule.value;
      break;
    case 'add_pct':
      result = base + (base * rule.value) / 100;
      break;
    default:
      result = base;
      break;
  }

  if (rule.mode !== 'static') {
    result = Math.max(0, result);
  }

  return { value: roundMoney(result), applied: true };
}

export function describeFieldAdjust(
  live: number | null | undefined,
  adjust: number | PartnersFieldAdjust | undefined
): string | null {
  const rule = normalizeFieldAdjust(adjust);
  if (!rule) return null;
  const applied = applyFieldAdjust(live, rule).value;
  const liveText = live == null ? '—' : String(roundMoney(live));

  switch (rule.mode) {
    case 'static':
      return `ثابت ${roundMoney(rule.value)}`;
    case 'subtract_pct':
      return `${liveText} − ${rule.value}% = ${applied}`;
    case 'keep_pct':
      return `${rule.value}% من ${liveText} = ${applied}`;
    case 'subtract_amt':
      return `${liveText} − ${roundMoney(rule.value)} = ${applied}`;
    case 'add_amt':
      return `${liveText} + ${roundMoney(rule.value)} = ${applied}`;
    case 'add_pct':
      return `${liveText} + ${rule.value}% = ${applied}`;
    default:
      return null;
  }
}

export function hasEmployeeOverrideValues(override: EmployeeMonthlyOverride | undefined): boolean {
  if (!override) return false;
  return (
    fieldAdjustIsActive(override.actualRevenue) ||
    fieldAdjustIsActive(override.salaryAndTarget) ||
    fieldAdjustIsActive(override.advanceExcess) ||
    override.paidSalaryOrAdvance !== undefined ||
    (override.note != null && String(override.note).trim() !== '')
  );
}

export function normalizeEmployeeOverride(raw: unknown): EmployeeMonthlyOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const row: EmployeeMonthlyOverride = {};

  const actualRevenue = normalizeFieldAdjust(src.actualRevenue);
  if (actualRevenue) row.actualRevenue = actualRevenue;

  const salaryAndTarget = normalizeFieldAdjust(src.salaryAndTarget);
  if (salaryAndTarget) row.salaryAndTarget = salaryAndTarget;

  const advanceExcess = normalizeFieldAdjust(src.advanceExcess);
  if (advanceExcess) row.advanceExcess = advanceExcess;

  if (
    src.paidSalaryOrAdvance !== undefined &&
    src.paidSalaryOrAdvance !== null &&
    src.paidSalaryOrAdvance !== ''
  ) {
    const n = Number(src.paidSalaryOrAdvance);
    if (Number.isFinite(n)) row.paidSalaryOrAdvance = n;
  }
  if (src.note !== undefined && src.note !== null && String(src.note).trim() !== '') {
    row.note = String(src.note).trim();
  }

  return hasEmployeeOverrideValues(row) ? row : null;
}

export function normalizeOverridesMap(raw: unknown): PartnersOverridesMap {
  const result: PartnersOverridesMap = {};
  if (!raw || typeof raw !== 'object') return result;

  for (const [monthKey, monthRows] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
    result[monthKey] = {};
    if (!monthRows || typeof monthRows !== 'object') continue;
    for (const [empId, override] of Object.entries(monthRows as Record<string, unknown>)) {
      const employeeId = Number(empId);
      if (!Number.isFinite(employeeId)) continue;
      const normalized = normalizeEmployeeOverride(override);
      if (normalized) result[monthKey][employeeId] = normalized;
    }
  }

  return result;
}

export function parsePartnersOverridesFile(raw: unknown): PartnersOverridesFile {
  if (raw && typeof raw === 'object' && (raw as { version?: unknown }).version === 2) {
    const src = raw as { branches?: unknown; legacy?: unknown };
    return {
      version: 2,
      branches: normalizeBranchBuckets(src.branches),
      legacy: normalizeOverridesMap(src.legacy ?? {}),
    };
  }

  return {
    version: 2,
    branches: {},
    legacy: normalizeOverridesMap(raw),
  };
}

function normalizeBranchBuckets(raw: unknown): Record<string, PartnersOverridesMap> {
  const result: Record<string, PartnersOverridesMap> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [branchId, map] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(branchId)) continue;
    result[branchId] = normalizeOverridesMap(map);
  }
  return result;
}

export function serializePartnersOverridesFile(file: PartnersOverridesFile): Record<string, unknown> {
  const branches: Record<string, Record<string, Record<string, EmployeeMonthlyOverride>>> = {};
  for (const [branchId, map] of Object.entries(file.branches)) {
    const serialized = serializeOverridesMap(map);
    if (Object.keys(serialized).length > 0) branches[branchId] = serialized;
  }

  const out: Record<string, unknown> = {
    version: 2,
    branches,
  };
  const legacy = serializeOverridesMap(file.legacy);
  if (Object.keys(legacy).length > 0) out.legacy = legacy;
  return out;
}

export function serializeOverridesMap(
  overrides: PartnersOverridesMap
): Record<string, Record<string, EmployeeMonthlyOverride>> {
  const result: Record<string, Record<string, EmployeeMonthlyOverride>> = {};
  for (const [monthKey, monthRows] of Object.entries(overrides)) {
    result[monthKey] = {};
    for (const [empId, override] of Object.entries(monthRows)) {
      result[monthKey][String(empId)] = override;
    }
  }
  return result;
}

export function resolveOverridesForBranch(
  file: PartnersOverridesFile,
  branchId: number,
  branchCode: string
): PartnersOverridesMap {
  const scoped = file.branches[String(branchId)] ?? {};
  if (branchCode !== LEGACY_OVERRIDES_BRANCH_CODE) return scoped;

  const merged: PartnersOverridesMap = { ...file.legacy };
  for (const [monthKey, rows] of Object.entries(scoped)) {
    merged[monthKey] = rows;
  }
  return merged;
}

export function upsertBranchMonthOverrides(
  file: PartnersOverridesFile,
  branchId: number,
  branchCode: string,
  monthKey: string,
  monthOverrides: Record<number, EmployeeMonthlyOverride>
): PartnersOverridesFile {
  const branches = { ...file.branches };
  const current = { ...(branches[String(branchId)] ?? {}) };

  if (Object.keys(monthOverrides).length === 0) {
    delete current[monthKey];
  } else {
    current[monthKey] = monthOverrides;
  }

  if (Object.keys(current).length === 0) {
    delete branches[String(branchId)];
  } else {
    branches[String(branchId)] = current;
  }

  let legacy = file.legacy;
  if (branchCode === LEGACY_OVERRIDES_BRANCH_CODE) {
    legacy = { ...file.legacy };
    delete legacy[monthKey];
  }

  return { version: 2, branches, legacy };
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
  paidSalaryOrAdvance?: number;
  salaryAndTarget: number;
  advanceExcess: number;
  isServiceWorker: boolean;
}): {
  shopRevenue: number | null;
  salaryAndTarget: number;
  advanceExcess: number;
  paidSalaryAndAdvances: number;
  hasSpecialAccounting: boolean;
  overridden: {
    shopRevenue: boolean;
    salaryAndTarget: boolean;
    advanceExcess: boolean;
  };
} {
  const override = params.override;
  const hasSpecialAccounting = hasEmployeeOverrideValues(override);
  const revenueRule = normalizeFieldAdjust(override?.actualRevenue);
  const salaryRule = normalizeFieldAdjust(override?.salaryAndTarget);
  const advanceRule = normalizeFieldAdjust(override?.advanceExcess);
  const hasLegacyPaidOverride =
    override?.paidSalaryOrAdvance !== undefined && !salaryRule && !advanceRule;

  let shopRevenue: number | null;
  if (revenueRule) {
    shopRevenue = applyFieldAdjust(params.actualRevenue, revenueRule).value;
  } else if (params.isServiceWorker) {
    shopRevenue = roundMoney(params.actualRevenue ?? 0);
  } else {
    shopRevenue = null;
  }

  let salaryAndTarget = roundMoney(params.salaryAndTarget);
  let advanceExcess = roundMoney(params.advanceExcess);

  if (salaryRule) {
    salaryAndTarget = applyFieldAdjust(params.salaryAndTarget, salaryRule).value;
  }
  if (advanceRule) {
    advanceExcess = applyFieldAdjust(params.advanceExcess, advanceRule).value;
  }
  if (hasLegacyPaidOverride) {
    salaryAndTarget = roundMoney(override!.paidSalaryOrAdvance!);
    advanceExcess = 0;
  }

  return {
    shopRevenue,
    salaryAndTarget,
    advanceExcess,
    paidSalaryAndAdvances: roundMoney(salaryAndTarget + advanceExcess),
    hasSpecialAccounting,
    overridden: {
      shopRevenue: revenueRule != null,
      salaryAndTarget: salaryRule != null || hasLegacyPaidOverride,
      advanceExcess: advanceRule != null || hasLegacyPaidOverride,
    },
  };
}
