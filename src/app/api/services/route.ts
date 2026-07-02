import { NextResponse, NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureTblProImageUrlColumn, tblProImageUrlSelect } from '@/lib/migrations/ensureServiceImageUrl';

// GET /api/services — returns services grouped by category, sorted by popularity
export async function GET() {
  try {
    const db = await getPool();
    const hasImageUrl = await ensureTblProImageUrlColumn(db);
    const imageUrlCol = tblProImageUrlSelect(hasImageUrl);
    const result = await db.request().query(`
      SELECT
        p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.Bonus,
        p.CatID, c.CatName,
        ISNULL(pop.SalesCount, 0) AS SalesCount,
        p.isDeleted,
        p.DurationMinutes,
        ${imageUrlCol}
      FROM [dbo].[TblPro] p
      LEFT JOIN [dbo].[TblCat] c ON p.CatID = c.CatID
      LEFT JOIN (
        SELECT ProID, COUNT(*) AS SalesCount
        FROM [dbo].[TblinvServDetail]
        GROUP BY ProID
      ) pop ON p.ProID = pop.ProID
      ORDER BY p.CatID, ISNULL(pop.SalesCount, 0) DESC, p.ProName
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/services — create a new service
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ProName, ProNameAr, SPrice1, Bonus, CatID, isActive, ImageUrl } = body;

    if (!ProName || !ProName.trim()) {
      return NextResponse.json({ error: 'اسم الخدمة مطلوب' }, { status: 400 });
    }

    if (SPrice1 === undefined || SPrice1 === null || SPrice1 < 0) {
      return NextResponse.json({ error: 'السعر مطلوب ويجب أن يكون رقم موجب' }, { status: 400 });
    }

    const db = await getPool();
    const hasImageUrl = await ensureTblProImageUrlColumn(db);
    const imageUrlCol = tblProImageUrlSelect(hasImageUrl);

    if (!hasImageUrl && ImageUrl?.trim()) {
      return NextResponse.json(
        { error: 'عمود ImageUrl غير متوفر في قاعدة البيانات — شغّل ترحيل /api/admin/migrate-service-image-url' },
        { status: 503 }
      );
    }

    const dbReq = db.request()
      .input('ProName', ProName.trim())
      .input('ProNameAr', ProNameAr?.trim() || null)
      .input('SPrice1', SPrice1)
      .input('Bonus', Bonus || 0)
      .input('CatID', CatID || null)
      .input('isDeleted', isActive ? 0 : 1);

    if (hasImageUrl) {
      dbReq.input('ImageUrl', ImageUrl?.trim() || null);
    }

    const insertCols = hasImageUrl
      ? '(ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted, ImageUrl)'
      : '(ProName, ProNameAr, SPrice1, Bonus, CatID, isDeleted)';
    const insertVals = hasImageUrl
      ? '(@ProName, @ProNameAr, @SPrice1, @Bonus, @CatID, @isDeleted, @ImageUrl)'
      : '(@ProName, @ProNameAr, @SPrice1, @Bonus, @CatID, @isDeleted)';

    const result = await dbReq.query(`
        INSERT INTO [dbo].[TblPro] ${insertCols}
        VALUES ${insertVals};
        
        SELECT 
          p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.Bonus, p.CatID, p.isDeleted,
          c.CatName,
          0 AS SalesCount,
          ${imageUrlCol}
        FROM [dbo].[TblPro] p
        LEFT JOIN [dbo].[TblCat] c ON p.CatID = c.CatID
        WHERE p.ProID = SCOPE_IDENTITY();
      `);

    const newService = result.recordset[0];
    return NextResponse.json(newService);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
