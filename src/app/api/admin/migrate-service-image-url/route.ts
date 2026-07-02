/**
 * POST /api/admin/migrate-service-image-url
 * Runs the TblPro ImageUrl migration (idempotent).
 * Protected: requires admin session.
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.UserLevel !== 'admin') {
      return NextResponse.json(
        { ok: false, error: 'غير مصرح - يتطلب صلاحيات المدير' },
        { status: 403 }
      );
    }

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
