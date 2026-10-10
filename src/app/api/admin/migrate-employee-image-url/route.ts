/**
 * POST /api/admin/migrate-employee-image-url
 * Runs the TblEmp ImageUrl migration (idempotent).
 * Protected: platform operator only (global schema/data maintenance).
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requirePlatformOperator } from '@/lib/api-auth';
import { ensureTblEmpImageUrlColumn } from '@/lib/migrations/ensureEmployeeImageUrl';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const operator = await requirePlatformOperator();
    if (operator instanceof NextResponse) return operator;

    const db = await getPool();
    const ready = await ensureTblEmpImageUrlColumn(db);

    return NextResponse.json({
      ok: ready,
      message: ready ? 'TblEmp.ImageUrl is ready' : 'TblEmp.ImageUrl migration failed',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/migrate-employee-image-url] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
