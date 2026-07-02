/**
 * POST /api/admin/seed-service-image-paths
 * Ensures TblPro.ImageUrl exists and seeds default paths for known services.
 * Idempotent — only updates rows with empty ImageUrl.
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSession } from '@/lib/session';
import { SERVICE_IMAGE_BY_PRO_NAME } from '@/lib/serviceImages';

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

    let updated = 0;
    let skipped = 0;
    const details: { proName: string; imageUrl: string; status: 'updated' | 'skipped' | 'not_found' }[] = [];

    for (const [proName, imageUrl] of Object.entries(SERVICE_IMAGE_BY_PRO_NAME)) {
      const existing = await db.request()
        .input('ProName', proName)
        .query(`SELECT ProID, ImageUrl FROM [dbo].[TblPro] WHERE ProName = @ProName`);

      if (existing.recordset.length === 0) {
        details.push({ proName, imageUrl, status: 'not_found' });
        continue;
      }

      const row = existing.recordset[0];
      const current = row.ImageUrl?.trim() || '';
      if (current) {
        skipped++;
        details.push({ proName, imageUrl: current, status: 'skipped' });
        continue;
      }

      await db.request()
        .input('ProName', proName)
        .input('ImageUrl', imageUrl)
        .query(`UPDATE [dbo].[TblPro] SET ImageUrl = @ImageUrl WHERE ProName = @ProName`);

      updated++;
      details.push({ proName, imageUrl, status: 'updated' });
    }

    return NextResponse.json({
      ok: true,
      message: 'Service image paths seeded',
      updated,
      skipped,
      details,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/seed-service-image-paths] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
