import 'server-only';

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES,
  parsePartnersOverridesFile,
  resolveOverridesForBranch,
  serializePartnersOverridesFile,
  upsertBranchMonthOverrides,
  type EmployeeMonthlyOverride,
  type PartnersOverridesFile,
  type PartnersOverridesMap,
} from '@/lib/reports/partnersEmployeeOverrides';

const OVERRIDES_FILE = path.join(process.cwd(), 'data', 'partners-employee-overrides.json');

async function ensureOverridesFile(): Promise<void> {
  await mkdir(path.dirname(OVERRIDES_FILE), { recursive: true });

  try {
    await readFile(OVERRIDES_FILE, 'utf-8');
  } catch {
    const initial = serializePartnersOverridesFile({
      version: 2,
      branches: {},
      legacy: DEFAULT_PARTNERS_EMPLOYEE_OVERRIDES,
    });
    await writeFile(OVERRIDES_FILE, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8');
  }
}

async function readOverridesFile(): Promise<PartnersOverridesFile> {
  await ensureOverridesFile();
  const raw = await readFile(OVERRIDES_FILE, 'utf-8');
  return parsePartnersOverridesFile(JSON.parse(raw) as unknown);
}

async function writeOverridesFile(file: PartnersOverridesFile): Promise<void> {
  await mkdir(path.dirname(OVERRIDES_FILE), { recursive: true });
  const serialized = serializePartnersOverridesFile(file);
  await writeFile(OVERRIDES_FILE, `${JSON.stringify(serialized, null, 2)}\n`, 'utf-8');
}

export async function loadPartnersEmployeeOverrides(): Promise<PartnersOverridesMap> {
  const file = await readOverridesFile();
  return file.legacy;
}

export async function loadPartnersEmployeeOverridesForBranch(
  branchId: number,
  branchCode: string
): Promise<PartnersOverridesMap> {
  const file = await readOverridesFile();
  return resolveOverridesForBranch(file, branchId, branchCode);
}

export async function savePartnersEmployeeOverridesForMonth(
  monthKey: string,
  monthOverrides: Record<number, EmployeeMonthlyOverride>,
  branchId: number,
  branchCode: string
): Promise<PartnersOverridesMap> {
  const file = await readOverridesFile();
  const next = upsertBranchMonthOverrides(file, branchId, branchCode, monthKey, monthOverrides);
  await writeOverridesFile(next);
  return resolveOverridesForBranch(next, branchId, branchCode);
}

export function getOverridesForMonth(
  overrides: PartnersOverridesMap,
  monthKey: string
): Record<number, EmployeeMonthlyOverride> {
  return overrides[monthKey] ?? {};
}
