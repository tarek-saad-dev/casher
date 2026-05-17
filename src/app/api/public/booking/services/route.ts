import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/services
 * Returns services available for online booking.
 * Strips internal-only fields.
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const settings = await getPublicSettings();
    const fallbackDur = settings.defaultServiceDurationMinutes;

    const db = await getPool();

    // Load services — filter out deleted, use DurationMinutes from TblPro if it exists
    const res = await db.request().query(`
      SELECT
        p.ProID      AS id,
        p.ProName    AS name,
        p.SPrice1    AS price,
        ISNULL(p.DurationMinutes, ${fallbackDur}) AS durationMinutes,
        c.CatName    AS categoryName
      FROM [dbo].[TblPro] p
      LEFT JOIN [dbo].[TblCat] c ON c.CatID = p.CatID
      WHERE ISNULL(p.isDeleted, 0) = 0
      ORDER BY c.CatName, p.ProName
    `).catch(() =>
      db.request().query(`
        SELECT
          p.ProID   AS id,
          p.ProName AS name,
          p.SPrice1 AS price,
          ${fallbackDur} AS durationMinutes,
          c.CatName AS categoryName
        FROM [dbo].[TblPro] p
        LEFT JOIN [dbo].[TblCat] c ON c.CatID = p.CatID
        WHERE ISNULL(p.isDeleted, 0) = 0
        ORDER BY c.CatName, p.ProName
      `)
    );

    const services = res.recordset.map((r: any) => ({
      id:               r.id,
      name:             r.name,
      price:            Number(r.price) || 0,
      durationMinutes:  Number(r.durationMinutes) || fallbackDur,
      categoryName:     r.categoryName ?? null,
      isBookableOnline: true,
    }));

    return NextResponse.json({ ok: true, services }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/services]', err);
    return NextResponse.json({ error: 'فشل تحميل الخدمات' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
