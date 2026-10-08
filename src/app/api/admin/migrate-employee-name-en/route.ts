/**
 * POST /api/admin/migrate-employee-name-en
 * Ensures TblEmp.EmpNameEn exists.
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requirePlatformOperator } from '@/lib/api-auth';
import { ensureTblEmpNameEnColumn } from '@/lib/migrations/ensureEmployeeNameEn';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const operator = await requirePlatformOperator();
    if (operator instanceof NextResponse) return operator;

    const db = await getPool();
    const ready = await ensureTblEmpNameEnColumn(db);
    return NextResponse.json({
      ok: ready,
      message: ready ? 'TblEmp.EmpNameEn is ready' : 'TblEmp.EmpNameEn migration failed',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/migrate-employee-name-en]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
