import 'server-only';

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES,
  type EmployeeMonthlyOverride,
  type PartnersOverridesMap,
} from '@/lib/reports/partnersEmployeeOverrides';

const OVERRIDES_FILE = path.join(process.cwd(), 'data', 'partners-employee-overrides.json');

type JsonOverridesFile = Record<
  string,
  Record<string, EmployeeMonthlyOverride>
>;

function normalizeOverrides(raw: JsonOverridesFile): PartnersOverridesMap {
  const result: PartnersOverridesMap = {};

  for (const [monthKey, monthRows] of Object.entries(raw ?? {})) {
    result[monthKey] = {};
    for (const [empId, override] of Object.entries(monthRows ?? {})) {
      const employeeId = Number(empId);
      if (!Number.isFinite(employeeId)) continue;
      result[monthKey][employeeId] = {
        ...(override.actualRevenue !== undefined
          ? { actualRevenue: Number(override.actualRevenue) }
          : {}),
        ...(override.paidSalaryOrAdvance !== undefined
          ? { paidSalaryOrAdvance: Number(override.paidSalaryOrAdvance) }
          : {}),
        ...(override.note !== undefined ? { note: String(override.note) } : {}),
      };
    }
  }

  return result;
}

function serializeOverrides(overrides: PartnersOverridesMap): JsonOverridesFile {
  const result: JsonOverridesFile = {};

  for (const [monthKey, monthRows] of Object.entries(overrides)) {
    result[monthKey] = {};
    for (const [empId, override] of Object.entries(monthRows)) {
      result[monthKey][String(empId)] = override;
    }
  }

  return result;
}

async function ensureOverridesFile(): Promise<void> {
  await mkdir(path.dirname(OVERRIDES_FILE), { recursive: true });

  try {
    await readFile(OVERRIDES_FILE, 'utf-8');
  } catch {
    const initial = serializeOverrides(DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES);
    await writeFile(OVERRIDES_FILE, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8');
  }
}

export async function loadPartnersEmployeeOverrides(): Promise<PartnersOverridesMap> {
  await ensureOverridesFile();
  const raw = await readFile(OVERRIDES_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as JsonOverridesFile;
  return normalizeOverrides(parsed);
}

export async function savePartnersEmployeeOverrides(
  overrides: PartnersOverridesMap
): Promise<void> {
  await mkdir(path.dirname(OVERRIDES_FILE), { recursive: true });
  const serialized = serializeOverrides(overrides);
  await writeFile(OVERRIDES_FILE, `${JSON.stringify(serialized, null, 2)}\n`, 'utf-8');
}

export async function savePartnersEmployeeOverridesForMonth(
  monthKey: string,
  monthOverrides: Record<number, EmployeeMonthlyOverride>
): Promise<PartnersOverridesMap> {
  const all = await loadPartnersEmployeeOverrides();

  if (Object.keys(monthOverrides).length === 0) {
    delete all[monthKey];
  } else {
    all[monthKey] = monthOverrides;
  }

  await savePartnersEmployeeOverrides(all);
  return all;
}

export function getOverridesForMonth(
  overrides: PartnersOverridesMap,
  monthKey: string
): Record<number, EmployeeMonthlyOverride> {
  return overrides[monthKey] ?? {};
}
