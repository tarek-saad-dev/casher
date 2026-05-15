import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

// PUT /api/finance/categories/[id] — update CatName (and optionally ExpINType)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });
    }

    const body = await req.json();
    const { CatName, ExpINType } = body;

    if (!CatName || !String(CatName).trim()) {
      return NextResponse.json({ error: "اسم الفئة مطلوب" }, { status: 400 });
    }

    const db = await getPool();
    const request = db.request()
      .input("ExpINID",   sql.Int,          id)
      .input("CatName",   sql.NVarChar(200), String(CatName).trim());

    let query: string;

    if (ExpINType && String(ExpINType).trim()) {
      request.input("ExpINType", sql.NVarChar(50), String(ExpINType).trim());
      query = `
        UPDATE dbo.TblExpINCat
        SET CatName = @CatName, ExpINType = @ExpINType
        OUTPUT INSERTED.ExpINID, INSERTED.CatName, INSERTED.ExpINType
        WHERE ExpINID = @ExpINID;
      `;
    } else {
      query = `
        UPDATE dbo.TblExpINCat
        SET CatName = @CatName
        OUTPUT INSERTED.ExpINID, INSERTED.CatName, INSERTED.ExpINType
        WHERE ExpINID = @ExpINID;
      `;
    }

    const result = await request.query(query);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: "الفئة غير موجودة" }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/finance/categories/[id]] PUT error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/finance/categories/[id] — delete a TblExpINCat category
// Guards: will not delete if the category is referenced by TblCashMove
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "معرّف غير صالح" }, { status: 400 });
    }

    const db = await getPool();

    const usageCheck = await db.request()
      .input("ExpINID", sql.Int, id)
      .query(`
        SELECT COUNT(*) AS UsageCount
        FROM dbo.TblCashMove
        WHERE ExpINID = @ExpINID;
      `);

    const usageCount: number = usageCheck.recordset[0]?.UsageCount ?? 0;
    if (usageCount > 0) {
      return NextResponse.json(
        { error: `لا يمكن حذف الفئة — مرتبطة بـ ${usageCount} حركة في السجلات` },
        { status: 409 }
      );
    }

    const result = await db.request()
      .input("ExpINID", sql.Int, id)
      .query(`
        DELETE FROM dbo.TblExpINCat
        OUTPUT DELETED.ExpINID, DELETED.CatName
        WHERE ExpINID = @ExpINID;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: "الفئة غير موجودة" }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: result.recordset[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/finance/categories/[id]] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
