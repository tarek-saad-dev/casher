import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// GET /api/customers?q=search_term
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  if (q.length < 1) {
    return NextResponse.json([]);
  }

  try {
    const db = await getPool();
    const result = await db.request()
      .input('q', sql.NVarChar(100), `%${q}%`)
      .query(`
        SELECT TOP 20 ClientID, [Name], Mobile, BirthDate, RegisterDate
        FROM [dbo].[TblClient]
        WHERE [Name] LIKE @q OR Mobile LIKE @q
        ORDER BY [Name]
      `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/customers  { name, mobile }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, mobile } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('name', sql.NVarChar(100), name.trim())
      .input('mobile', sql.NVarChar(30), mobile?.trim() || null)
      .query(`
        INSERT INTO [dbo].[TblClient] ([Name], Mobile, RegisterDate)
        OUTPUT INSERTED.ClientID, INSERTED.[Name], INSERTED.Mobile
        VALUES (@name, @mobile, GETDATE())
      `);

    return NextResponse.json(result.recordset[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
