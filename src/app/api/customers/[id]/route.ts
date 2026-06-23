import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { validateCustomerSource } from '@/lib/customerSource';
import { getUserFriendlyError } from '@/lib/db';

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
    const { mobile, birthDate, address, notes, cameFrom, cameFromDetails, referralCode } = body;

    const db = await getPool();

    // Validate source fields whenever any of them is present
    const sourceSent =
      cameFrom !== undefined ||
      cameFromDetails !== undefined ||
      referralCode !== undefined;
    let sourceValidation = validateCustomerSource(cameFrom, cameFromDetails, referralCode);
    if (sourceSent) {
      if (Object.keys(sourceValidation.errors).length > 0) {
        const firstError =
          sourceValidation.errors.cameFrom ||
          sourceValidation.errors.cameFromDetails ||
          sourceValidation.errors.referralCode ||
          'بيانات المصدر غير صالحة';
        return NextResponse.json({ error: firstError }, { status: 400 });
      }
    } else {
      // No source fields sent — keep DB values untouched by treating validation as empty
      sourceValidation = { cameFrom: null, cameFromDetails: null, referralCode: null, errors: {} };
    }

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
    if (sourceSent) {
      setClauses.push('CameFrom = @cameFrom');
      request.input('cameFrom', sql.NVarChar(50), sourceValidation.cameFrom);
      setClauses.push('CameFromDetails = @cameFromDetails');
      request.input('cameFromDetails', sql.NVarChar(150), sourceValidation.cameFromDetails);
      setClauses.push('ReferralCode = @referralCode');
      request.input('referralCode', sql.NVarChar(50), sourceValidation.referralCode);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'لا توجد بيانات للتحديث' }, { status: 400 });
    }

    const result = await request.query(`
      UPDATE [dbo].[TblClient]
      SET ${setClauses.join(', ')}
      OUTPUT
        INSERTED.ClientID, INSERTED.[Name], INSERTED.Mobile,
        INSERTED.BirthDate, INSERTED.Address, INSERTED.Notes, INSERTED.RegisterDate,
        INSERTED.CameFrom, INSERTED.CameFromDetails, INSERTED.ReferralCode
      WHERE ClientID = @clientID
    `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers/[id]] PATCH error:', message);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}
