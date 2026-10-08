/**
 * POST /api/admin/migrate-service-image-url
 * Runs the TblPro ImageUrl migration (idempotent).
 * Protected: platform operator only (global schema/data maintenance).
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requirePlatformOperator } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const operator = await requirePlatformOperator();
    if (operator instanceof NextResponse) return operator;

    const db = await getPool();

    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblPro', N'ImageUrl') IS NULL
      BEGIN
        ALTER TABLE dbo.TblPro
        ADD ImageUrl NVARCHAR(1000) NULL;
      END;
    `);

    return NextResponse.json({ ok: true, message: 'TblPro.ImageUrl is ready' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/migrate-service-image-url] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
