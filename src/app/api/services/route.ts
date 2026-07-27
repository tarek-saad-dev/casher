import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ensureTblProImageUrlColumn, tblProImageUrlSelect } from '@/lib/migrations/ensureServiceImageUrl';
import { invalidatePublicBookingServicesCache } from '@/lib/booking/publicBookingServices';

/** Product retail categories (CatType may be wrong/missing — name is the safety net). */
const PRODUCT_CATEGORY_NAME_PATTERNS = [
  'منتجات',
  'منتج',
  'اكسسوارات',
  'إكسسوارات',
  'اكسيسوارات',
  'إكسيسوارات',
  'عطور',
  'برفانات',
  'براندات',
  'براند',
] as const;

/** Align with public booking — products + internal/non-bookable cats. */
const EXCLUDED_CATEGORY_PATTERNS = [
  ...PRODUCT_CATEGORY_NAME_PATTERNS,
  'إداريات',
  'اداريات',
  'عائد',
  'الخزنه',
  'الخزنة',
  'مساعدين',
] as const;

const EXCLUDED_SERVICE_NAME_PATTERNS = [
  'عائد للخزنه',
  'عائد للخزنة',
  'كاش',
  'خزنة',
  'خزنه',
] as const;

function matchesAnyPattern(value: string, patterns: readonly string[]): boolean {
  const n = value.trim().toLowerCase();
  return patterns.some((p) => n.includes(p.toLowerCase()));
}

function isExcludedCategoryName(catName: string | null | undefined): boolean {
  if (!catName) return false;
  return matchesAnyPattern(catName, EXCLUDED_CATEGORY_PATTERNS);
}

function isExcludedServiceName(proName: string | null | undefined): boolean {
  if (!proName) return false;
  return matchesAnyPattern(proName, EXCLUDED_SERVICE_NAME_PATTERNS);
}

type ServiceRow = {
  ProID: number;
  ProName: string;
  ProNameAr?: string | null;
  SPrice1: number | null;
  Bonus?: number | null;
  CatID: number | null;
  CatName: string | null;
  CatType?: string | null;
  ProType?: string | null;
  SalesCount?: number;
  isDeleted: number | boolean | null;
  DurationMinutes: number | null;
  ImageUrl?: string | null;
};

function isBookableSalonService(row: ServiceRow): boolean {
  if (Number(row.isDeleted) === 1) return false;
  if (!row.SPrice1 || Number(row.SPrice1) <= 0) return false;
  if (String(row.CatType ?? '').toLowerCase() === 'pro') return false;
  if (isExcludedCategoryName(row.CatName)) return false;
  if (isExcludedServiceName(row.ProName)) return false;
  return true;
}

function toOpsService(row: ServiceRow) {
  return {
    ProID: row.ProID,
    ProName: row.ProName,
    ProNameAr: row.ProNameAr ?? null,
    SPrice: Number(row.SPrice1) || 0,
    SPrice1: row.SPrice1 != null ? Number(row.SPrice1) : null,
    DurationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
    isDeleted: row.isDeleted,
    CatID: row.CatID,
    CatName: row.CatName ?? null,
    CatType: row.CatType ?? null,
  };
}

// GET /api/services — flat list (legacy). Prefer GET /api/services/catalog for nested bilingual catalog.
// Query: active=true (exclude deleted), bookable=true (salon services only, ops booking/queue).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get('active') === 'true';
    const bookableOnly = searchParams.get('bookable') === 'true';

    const db = await getPool();
    const hasImageUrl = await ensureTblProImageUrlColumn(db);
    const imageUrlCol = tblProImageUrlSelect(hasImageUrl);
    const result = await db.request().query(`
      SELECT
        p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.Bonus,
        p.CatID, c.CatName, c.CatType,
        ISNULL(p.ProType, '') AS ProType,
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

    let rows = result.recordset as ServiceRow[];

    if (activeOnly || bookableOnly) {
      rows = rows.filter((r) => Number(r.isDeleted) !== 1);
    }

    if (bookableOnly) {
      rows = rows.filter(isBookableSalonService);
      return NextResponse.json({
        ok: true,
        services: rows.map(toOpsService),
      });
    }

    if (activeOnly) {
      // Ops callers historically expect `{ services }` and map SPrice ?? SPrice1.
      return NextResponse.json({
        ok: true,
        services: rows.map(toOpsService),
      });
    }

    return NextResponse.json(rows);
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
        { status: 503 },
      );
    }

    const dbReq = db
      .request()
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
    invalidatePublicBookingServicesCache();
    return NextResponse.json(newService);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
