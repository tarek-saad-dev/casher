import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

// GET /api/finance/categories?type=ايرادات or type=مصروفات
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');

    const db = await getPool();
    let query = `
      SELECT 
        ExpINID,
        CatName,
        ExpINType
      FROM dbo.TblExpINCat
    `;
    
    const request = db.request();
    
    if (type) {
      query += ` WHERE ExpINType = @type ORDER BY CatName`;
      request.input("type", sql.NVarChar(50), type);
    } else {
      query += ` ORDER BY ExpINType, CatName`;
    }

    const result = await request.query(query);
    
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/finance/categories] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
