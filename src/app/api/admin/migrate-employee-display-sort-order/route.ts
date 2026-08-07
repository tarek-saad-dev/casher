/**
 * POST /api/admin/migrate-employee-display-sort-order
 * Ensures TblEmp.DisplaySortOrder exists.
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { ensureTblEmpDisplaySortOrderColumn } from '@/lib/migrations/ensureEmployeeDisplaySortOrder';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.UserLevel !== 'admin') {
      return NextResponse.json(
        { ok: false, error: 'غير مصرح - يتطلب صلاحيات المدير' },
        { status: 403 },
      );
    }

    const db = await getPool();
    const ready = await ensureTblEmpDisplaySortOrderColumn(db);
    return NextResponse.json({
      ok: ready,
      message: ready
        ? 'TblEmp.DisplaySortOrder is ready'
        : 'TblEmp.DisplaySortOrder migration failed',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/migrate-employee-display-sort-order]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
