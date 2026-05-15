import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

// GET /api/finance/categories?type=ايرادات|مصروفات&activeOnly=true
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type       = searchParams.get('type');
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const db = await getPool();
    let query = `
      SELECT
        ExpINID,
        CatName,
        ExpINType,
        IsActive
      FROM dbo.TblExpINCat
    `;

    const conditions: string[] = [];
    const request = db.request();

    if (type) {
      conditions.push('ExpINType = @type');
      request.input('type', sql.NVarChar(50), type);
    }
    if (activeOnly) {
      conditions.push('IsActive = 1');
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY ExpINType, CatName';

    const result = await request.query(query);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/finance/categories] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/finance/categories — create a new TblExpINCat category
// Body: { CatName: string, ExpINType?: string }
// ExpINType defaults to N'مصروفات' (expense). Use N'ايرادات' for income.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { CatName, ExpINType } = body;

    if (!CatName || !String(CatName).trim()) {
      return NextResponse.json({ error: "اسم الفئة مطلوب" }, { status: 400 });
    }

    const catType: string = ExpINType && String(ExpINType).trim()
      ? String(ExpINType).trim()
      : "مصروفات";

    const db = await getPool();
    const result = await db.request()
      .input('CatName',   sql.NVarChar(200), String(CatName).trim())
      .input('ExpINType', sql.NVarChar(50),  catType)
      .query(`
        INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
        OUTPUT INSERTED.ExpINID, INSERTED.CatName, INSERTED.ExpINType, INSERTED.IsActive
        VALUES (@CatName, @ExpINType);
      `);

    return NextResponse.json(result.recordset[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/finance/categories] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
