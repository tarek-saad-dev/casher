import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireRole } from '@/lib/api-auth';
import {
  createEmployeeAlias,
  getAccountingSettingsMigrationStatus,
  listEmployeeAliases,
  listEmployees,
  updateEmployeeAlias,
} from '@/lib/accounting/accountingSettingsService';

export async function GET() {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const status = await getAccountingSettingsMigrationStatus();
    const employees = await listEmployees();
    const aliases = status.migrationRequired ? [] : await listEmployeeAliases();
    return NextResponse.json({
      aliases,
      employees,
      meta: {
        migrationRequired: status.migrationRequired,
        tablesExist: status.tablesExist,
        missingTables: status.missingTables,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await request.json();
    if (!body.empId || !body.aliasText) {
      return NextResponse.json({ error: 'empId و aliasText مطلوبان' }, { status: 400 });
    }
    const alias = await createEmployeeAlias(Number(body.empId), body.aliasText, auth.userId);
    return NextResponse.json({ alias });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 });
    await updateEmployeeAlias(Number(body.id), body, auth.userId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}
