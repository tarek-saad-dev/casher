import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessPath } from '@/lib/permissions-server';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { getPool } from '@/lib/db';
import {
  getPartnersMonthKey,
  moneyEquals,
  normalizeEmployeeOverride,
  normalizeFieldAdjust,
  PARTNERS_OVERRIDE_PRESET_EMPLOYEES,
  type EmployeeMonthlyOverride,
  type PartnersFieldAdjust,
} from '@/lib/reports/partnersEmployeeOverrides';
import { savePartnersEmployeeOverridesForMonth } from '@/lib/reports/partnersEmployeeOverridesStore';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';
import { buildPartnersEmployeeControlSheet } from '@/lib/services/partnersReportService';

const OVERRIDES_PAGE_PATH = '/admin/reports/partners-overrides';

async function requireOverridesAccess() {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'غير مصرح — يرجى تسجيل الدخول' }, { status: 401 }) };
  }

  const allowed = await canAccessPath(
    session.UserID,
    session.UserName,
    session.UserLevel,
    OVERRIDES_PAGE_PATH
  );
  if (!allowed) {
    return {
      error: NextResponse.json(
        { error: 'غير مصرح — لا تملك صلاحية تعديل الحسابات الخاصة' },
        { status: 403 }
      ),
    };
  }

  const branch = await requireActiveBranchContext();
  if (!isActiveBranchContext(branch)) {
    return { error: branch };
  }

  return { session, branch };
}

async function loadEmployeeCatalog(): Promise<Array<{ employeeId: number; employeeName: string }>> {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT EmpID, ISNULL(EmpName, N'غير محدد') AS EmpName
    FROM dbo.TblEmp
    ORDER BY EmpName
  `);

  return (result.recordset as { EmpID: number; EmpName: string }[]).map((row) => ({
    employeeId: row.EmpID,
    employeeName: row.EmpName,
  }));
}

function adjustForSave(
  raw: unknown,
  live: number | null | undefined
): PartnersFieldAdjust | undefined {
  const rule = normalizeFieldAdjust(raw);
  if (!rule) return undefined;
  // Drop no-op static equals live so "من النظام" stays clean after round-trip.
  if (rule.mode === 'static' && moneyEquals(rule.value, live ?? null)) return undefined;
  return rule;
}

function overrideForSave(
  entry: Record<string, unknown>,
  live: { shopRevenue: number | null; salaryAndTarget: number; advanceExcess: number } | undefined
): EmployeeMonthlyOverride | null {
  const note =
    entry.note !== undefined && entry.note !== null && String(entry.note).trim() !== ''
      ? String(entry.note).trim()
      : undefined;

  const saved: EmployeeMonthlyOverride = {};
  if (note) saved.note = note;

  const shop = adjustForSave(entry.actualRevenue ?? entry.shopRevenue, live?.shopRevenue ?? null);
  if (shop) saved.actualRevenue = shop;

  const salary = adjustForSave(entry.salaryAndTarget, live?.salaryAndTarget);
  if (salary) saved.salaryAndTarget = salary;

  const advance = adjustForSave(entry.advanceExcess, live?.advanceExcess);
  if (advance) saved.advanceExcess = advance;

  // Accept full normalize path for legacy paidSalaryOrAdvance if somehow sent.
  const normalized = normalizeEmployeeOverride({ ...saved, paidSalaryOrAdvance: entry.paidSalaryOrAdvance });
  return normalized;
}

/**
 * GET /api/admin/reports/partners-overrides?year=2026&month=6
 */
export async function GET(req: NextRequest) {
  try {
    const access = await requireOverridesAccess();
    if (access.error) return access.error;

    const url = new URL(req.url);
    const { year, month } = parseMonthYearParams(
      url.searchParams.get('year'),
      url.searchParams.get('month')
    );

    const validationError = validateMonthYear(year, month);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const monthKey = getPartnersMonthKey(year, month);
    const [sheet, catalog] = await Promise.all([
      buildPartnersEmployeeControlSheet(year, month, access.branch.branchId),
      loadEmployeeCatalog(),
    ]);

    return NextResponse.json({
      year,
      month,
      monthKey,
      branchId: sheet.branchId,
      branchCode: sheet.branchCode,
      branchName: sheet.branchName,
      employees: sheet.employees,
      presetEmployees: PARTNERS_OVERRIDE_PRESET_EMPLOYEES,
      catalog,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/partners-overrides] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/admin/reports/partners-overrides
 * Body: { year, month, entries: [{ employeeId, actualRevenue?, salaryAndTarget?, advanceExcess?, note? }] }
 * Field values may be a number (legacy static) or { mode, value }.
 */
export async function PUT(req: NextRequest) {
  try {
    const access = await requireOverridesAccess();
    if (access.error) return access.error;

    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const validationError = validateMonthYear(year, month);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (!Array.isArray(body.entries)) {
      return NextResponse.json({ error: 'صيغة البيانات غير صحيحة' }, { status: 400 });
    }

    const monthKey = getPartnersMonthKey(year, month);
    const sheet = await buildPartnersEmployeeControlSheet(year, month, access.branch.branchId);
    const liveById = new Map(sheet.employees.map((row) => [row.employeeId, row.live]));

    const monthOverrides: Record<number, EmployeeMonthlyOverride> = {};

    for (const entry of body.entries) {
      const employeeId = Number(entry.employeeId);
      if (!Number.isFinite(employeeId) || employeeId <= 0) continue;
      const saved = overrideForSave(entry, liveById.get(employeeId));
      if (saved) monthOverrides[employeeId] = saved;
    }

    await savePartnersEmployeeOverridesForMonth(
      monthKey,
      monthOverrides,
      access.branch.branchId,
      access.branch.branchCode
    );

    const refreshed = await buildPartnersEmployeeControlSheet(year, month, access.branch.branchId);

    return NextResponse.json({
      success: true,
      year,
      month,
      monthKey,
      branchId: refreshed.branchId,
      branchCode: refreshed.branchCode,
      branchName: refreshed.branchName,
      employees: refreshed.employees,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/partners-overrides] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
