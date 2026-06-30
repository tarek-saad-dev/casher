import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessPath } from '@/lib/permissions-server';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { getPool } from '@/lib/db';
import {
  getPartnersMonthKey,
  PARTNERS_OVERRIDE_PRESET_EMPLOYEES,
} from '@/lib/reports/partnersEmployeeOverrides';
import {
  getOverridesForMonth,
  loadPartnersEmployeeOverrides,
  savePartnersEmployeeOverridesForMonth,
} from '@/lib/reports/partnersEmployeeOverridesStore';

const OVERRIDES_PAGE_PATH = '/admin/reports/partners-overrides';

export interface PartnersOverrideEntry {
  employeeId: number;
  employeeName: string;
  actualRevenue?: number;
  paidSalaryOrAdvance?: number;
  note?: string;
}

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

  return { session };
}

async function loadEmployeeNames(): Promise<Map<number, string>> {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT EmpID, ISNULL(EmpName, N'غير محدد') AS EmpName
    FROM dbo.TblEmp
    ORDER BY EmpName
  `);

  const map = new Map<number, string>();
  for (const row of result.recordset as { EmpID: number; EmpName: string }[]) {
    map.set(row.EmpID, row.EmpName);
  }
  return map;
}

function buildEntries(
  monthOverrides: Record<number, { actualRevenue?: number; paidSalaryOrAdvance?: number; note?: string }>,
  employeeNames: Map<number, string>
): PartnersOverrideEntry[] {
  return Object.entries(monthOverrides)
    .map(([empId, override]) => ({
      employeeId: Number(empId),
      employeeName: employeeNames.get(Number(empId)) ?? `موظف #${empId}`,
      actualRevenue: override.actualRevenue,
      paidSalaryOrAdvance: override.paidSalaryOrAdvance,
      note: override.note,
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ar'));
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
    const [overrides, employeeNames] = await Promise.all([
      loadPartnersEmployeeOverrides(),
      loadEmployeeNames(),
    ]);

    const monthOverrides = getOverridesForMonth(overrides, monthKey);

    return NextResponse.json({
      year,
      month,
      monthKey,
      entries: buildEntries(monthOverrides, employeeNames),
      presetEmployees: PARTNERS_OVERRIDE_PRESET_EMPLOYEES,
      employees: [...employeeNames.entries()].map(([employeeId, employeeName]) => ({
        employeeId,
        employeeName,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/partners-overrides] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/admin/reports/partners-overrides
 * Body: { year, month, entries: [{ employeeId, actualRevenue?, paidSalaryOrAdvance?, note? }] }
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
    const monthOverrides: Record<number, {
      actualRevenue?: number;
      paidSalaryOrAdvance?: number;
      note?: string;
    }> = {};

    for (const entry of body.entries) {
      const employeeId = Number(entry.employeeId);
      if (!Number.isFinite(employeeId) || employeeId <= 0) continue;

      const row: {
        actualRevenue?: number;
        paidSalaryOrAdvance?: number;
        note?: string;
      } = {};

      if (entry.actualRevenue !== undefined && entry.actualRevenue !== null && entry.actualRevenue !== '') {
        row.actualRevenue = Number(entry.actualRevenue);
      }
      if (
        entry.paidSalaryOrAdvance !== undefined &&
        entry.paidSalaryOrAdvance !== null &&
        entry.paidSalaryOrAdvance !== ''
      ) {
        row.paidSalaryOrAdvance = Number(entry.paidSalaryOrAdvance);
      }
      if (entry.note !== undefined && entry.note !== null && String(entry.note).trim() !== '') {
        row.note = String(entry.note).trim();
      }

      if (Object.keys(row).length > 0) {
        monthOverrides[employeeId] = row;
      }
    }

    await savePartnersEmployeeOverridesForMonth(monthKey, monthOverrides);

    const employeeNames = await loadEmployeeNames();

    return NextResponse.json({
      success: true,
      year,
      month,
      monthKey,
      entries: buildEntries(monthOverrides, employeeNames),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/reports/partners-overrides] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
