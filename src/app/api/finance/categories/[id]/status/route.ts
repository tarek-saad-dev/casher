import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// PATCH /api/finance/categories/[id]/status
// Body: { isActive: boolean }
// Soft-toggles IsActive without deleting the record.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'قيمة isActive مطلوبة (true/false)' }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('ExpINID',   sql.Int, id)
      .input('IsActive',  sql.Bit, body.isActive ? 1 : 0)
      .query(`
        UPDATE dbo.TblExpINCat
        SET IsActive = @IsActive
        OUTPUT
          INSERTED.ExpINID,
          INSERTED.CatName,
          INSERTED.ExpINType,
          INSERTED.IsActive
        WHERE ExpINID = @ExpINID;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'الفئة غير موجودة' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/finance/categories/[id]/status] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
