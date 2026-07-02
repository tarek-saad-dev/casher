import { NextResponse, NextRequest } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { ensureTblProImageUrlColumn, tblProImageUrlSelect } from '@/lib/migrations/ensureServiceImageUrl';

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
      .input('ProID', serviceId)
      .input('ProName', ProName.trim())
      .input('ProNameAr', ProNameAr?.trim() || null)
      .input('SPrice1', SPrice1)
      .input('Bonus', Bonus || 0)
      .input('CatID', CatID || null)
      .input('isDeleted', isActive ? 0 : 1);

    if (hasImageUrl) {
      dbReq.input('ImageUrl', ImageUrl?.trim() || null);
    }

    const imageUrlSet = hasImageUrl ? ',\n            ImageUrl = @ImageUrl' : '';

    const result = await dbReq.query(`
        UPDATE [dbo].[TblPro]
        SET ProName = @ProName, 
            ProNameAr = @ProNameAr,
            SPrice1 = @SPrice1, 
            Bonus = @Bonus, 
            CatID = @CatID, 
            isDeleted = @isDeleted${imageUrlSet}
        WHERE ProID = @ProID;
        
        SELECT 
          p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.Bonus, p.CatID, p.isDeleted,
          c.CatName,
          ISNULL(pop.SalesCount, 0) AS SalesCount,
          ${imageUrlCol}
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
    const { durationMinutes, ImageUrl, imageUrl } = body as {
      durationMinutes?: number | null;
      ImageUrl?: string | null;
      imageUrl?: string | null;
    };
    const resolvedImageUrl = ImageUrl !== undefined ? ImageUrl : imageUrl;

    if (durationMinutes !== undefined && durationMinutes !== null) {
      if (typeof durationMinutes !== 'number' || durationMinutes < 5 || durationMinutes > 240) {
        return NextResponse.json({ error: 'مدة الخدمة يجب أن تكون بين 5 و 240 دقيقة' }, { status: 400 });
      }
    }

    const db = await getPool();
    const hasImageUrl = await ensureTblProImageUrlColumn(db);
    const imageUrlCol = tblProImageUrlSelect(hasImageUrl);
    const reqUpdate = db.request().input('ProID', sql.Int, serviceId);
    const updateFields: string[] = [];

    if (durationMinutes !== undefined) {
      updateFields.push('DurationMinutes = @durationMinutes');
      reqUpdate.input('durationMinutes', sql.Int, durationMinutes ?? null);
    }

    if (resolvedImageUrl !== undefined) {
      if (!hasImageUrl && resolvedImageUrl?.trim()) {
        return NextResponse.json(
          { error: 'عمود ImageUrl غير متوفر في قاعدة البيانات — شغّل ترحيل /api/admin/migrate-service-image-url' },
          { status: 503 }
        );
      }
      if (hasImageUrl) {
        updateFields.push('ImageUrl = @imageUrl');
        reqUpdate.input('imageUrl', sql.NVarChar(1000), resolvedImageUrl?.trim() || null);
      }
    }

    if (updateFields.length > 0) {
      await reqUpdate.query(`UPDATE [dbo].[TblPro] SET ${updateFields.join(', ')} WHERE ProID = @ProID`);
    }

    const result = await db.request()
      .input('ProID', sql.Int, serviceId)
      .query(`SELECT ProID, ProName, SPrice1, Bonus, CatID, isDeleted, DurationMinutes, ${imageUrlCol} FROM [dbo].[TblPro] p WHERE ProID = @ProID`);

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
