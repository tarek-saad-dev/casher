import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/customers/[id] — update only provided fields (partial update)
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const clientID = parseInt(id);
    if (isNaN(clientID)) {
      return NextResponse.json({ error: 'معرف العميل غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { mobile, birthDate, address, notes } = body;

    const db = await getPool();

    // Build dynamic SET clause — only update fields that were sent
    const setClauses: string[] = [];
    const request = db.request().input('clientID', sql.Int, clientID);

    if (mobile !== undefined) {
      setClauses.push('Mobile = @mobile');
      request.input('mobile', sql.NVarChar(30), mobile?.trim() || null);
    }
    if (birthDate !== undefined) {
      setClauses.push('BirthDate = @birthDate');
      request.input('birthDate', sql.Date, birthDate || null);
    }
    if (address !== undefined) {
      setClauses.push('Address = @address');
      request.input('address', sql.NVarChar(200), address?.trim() || null);
    }
    if (notes !== undefined) {
      setClauses.push('Notes = @notes');
      request.input('notes', sql.NVarChar(500), notes?.trim() || null);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'لا توجد بيانات للتحديث' }, { status: 400 });
    }

    const result = await request.query(`
      UPDATE [dbo].[TblClient]
      SET ${setClauses.join(', ')}
      OUTPUT
        INSERTED.ClientID, INSERTED.[Name], INSERTED.Mobile,
        INSERTED.BirthDate, INSERTED.Address, INSERTED.Notes, INSERTED.RegisterDate
      WHERE ClientID = @clientID
    `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers/[id]] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
