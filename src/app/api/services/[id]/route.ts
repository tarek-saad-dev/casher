import { NextResponse, NextRequest } from 'next/server';
import { getPool, sql } from '@/lib/db';

// PUT /api/services/[id] — update a service
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const serviceId = parseInt(id);
    
    if (isNaN(serviceId)) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { ProName, SPrice1, Bonus, CatID, isActive } = body;

    if (!ProName || !ProName.trim()) {
      return NextResponse.json({ error: 'اسم الخدمة مطلوب' }, { status: 400 });
    }

    if (SPrice1 === undefined || SPrice1 === null || SPrice1 < 0) {
      return NextResponse.json({ error: 'السعر مطلوب ويجب أن يكون رقم موجب' }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('ProID', serviceId)
      .input('ProName', ProName.trim())
      .input('SPrice1', SPrice1)
      .input('Bonus', Bonus || 0)
      .input('CatID', CatID || null)
      .input('isDeleted', isActive ? 0 : 1)
      .query(`
        UPDATE [dbo].[TblPro]
        SET ProName = @ProName, 
            SPrice1 = @SPrice1, 
            Bonus = @Bonus, 
            CatID = @CatID, 
            isDeleted = @isDeleted
        WHERE ProID = @ProID;
        
        SELECT 
          p.ProID, p.ProName, p.SPrice1, p.Bonus, p.CatID, p.isDeleted,
          c.CatName,
          ISNULL(pop.SalesCount, 0) AS SalesCount
        FROM [dbo].[TblPro] p
        LEFT JOIN [dbo].[TblCat] c ON p.CatID = c.CatID
        LEFT JOIN (
          SELECT ProID, COUNT(*) AS SalesCount
          FROM [dbo].[TblinvServDetail]
          GROUP BY ProID
        ) pop ON p.ProID = pop.ProID
        WHERE p.ProID = @ProID;
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }

    const updatedService = result.recordset[0];
    return NextResponse.json(updatedService);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/services/[id] — partial update (e.g. durationMinutes only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const serviceId = parseInt(id);
    if (isNaN(serviceId)) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { durationMinutes } = body as { durationMinutes?: number | null };

    if (durationMinutes !== undefined && durationMinutes !== null) {
      if (typeof durationMinutes !== 'number' || durationMinutes < 5 || durationMinutes > 240) {
        return NextResponse.json({ error: 'مدة الخدمة يجب أن تكون بين 5 و 240 دقيقة' }, { status: 400 });
      }
    }

    const db = await getPool();
    await db.request()
      .input('ProID', sql.Int, serviceId)
      .input('DurationMinutes', sql.Int, durationMinutes ?? null)
      .query(`UPDATE [dbo].[TblPro] SET DurationMinutes = @DurationMinutes WHERE ProID = @ProID`);

    const result = await db.request()
      .input('ProID', sql.Int, serviceId)
      .query(`SELECT ProID, ProName, SPrice1, Bonus, CatID, isDeleted, DurationMinutes FROM [dbo].[TblPro] WHERE ProID = @ProID`);

    if (!result.recordset[0]) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, service: result.recordset[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/services/[id] — soft delete a service
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const serviceId = parseInt(id);
    
    if (isNaN(serviceId)) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    // Check if service exists
    const serviceResult = await db.request()
      .input('ProID', serviceId)
      .query(`SELECT ProID FROM [dbo].[TblPro] WHERE ProID = @ProID`);

    if (serviceResult.recordset.length === 0) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }

    // Soft delete the service
    await db.request()
      .input('ProID', serviceId)
      .query(`UPDATE [dbo].[TblPro] SET isDeleted = 1 WHERE ProID = @ProID`);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
