import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { validateCustomerSource } from '@/lib/customerSource';
import { validateCustomerProfile } from '@/lib/customerProfile';
import { authenticate, isAuthResult } from '@/lib/api-auth';

// GET /api/customers?q=search_term
export async function GET(req: NextRequest) {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;
  const q = req.nextUrl.searchParams.get('q') || '';
  if (q.length < 1) {
    return NextResponse.json([]);
  }

  try {
    const db = await getPool();
    const result = await db.request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('q', sql.NVarChar(100), `%${q}%`)
      .query(`
        SELECT TOP 20
          ClientID, [Name], Mobile, BirthDate, Address, RegisterDate, Notes,
          CameFrom, CameFromDetails, ReferralCode,
          CustomerCategory, EducationLevel, InstitutionName, Occupation
        FROM [dbo].[TblClient]
        WHERE TenantId = @tenantId AND ([Name] LIKE @q OR Mobile LIKE @q)
        ORDER BY [Name]
      `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/customers  { name, mobile, birthDate, address, notes, cameFrom, cameFromDetails, referralCode }
export async function POST(req: NextRequest) {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const { name, mobile, birthDate, address, notes, cameFrom, cameFromDetails, referralCode,
      customerCategory, educationLevel, institutionName, occupation } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 });
    }

    const sourceValidation = validateCustomerSource(cameFrom, cameFromDetails, referralCode);
    if (cameFrom !== undefined && cameFrom !== null && cameFrom !== '' && Object.keys(sourceValidation.errors).length > 0) {
      return NextResponse.json({ error: sourceValidation.errors.cameFrom || sourceValidation.errors.cameFromDetails || sourceValidation.errors.referralCode || 'بيانات المصدر غير صالحة' }, { status: 400 });
    }

    const profile = validateCustomerProfile(customerCategory, educationLevel, institutionName, occupation);
    if (Object.keys(profile.errors).length) {
      return NextResponse.json({ error: Object.values(profile.errors)[0] }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('name', sql.NVarChar(100), name.trim())
      .input('mobile', sql.NVarChar(30), mobile?.trim() || null)
      .input('birthDate', sql.Date, birthDate || null)
      .input('address', sql.NVarChar(200), address?.trim() || null)
      .input('notes', sql.NVarChar(500), notes?.trim() || null)
      .input('cameFrom', sql.NVarChar(50), sourceValidation.cameFrom)
      .input('cameFromDetails', sql.NVarChar(150), sourceValidation.cameFromDetails)
      .input('referralCode', sql.NVarChar(50), sourceValidation.referralCode)
      .input('customerCategory', sql.NVarChar(16), profile.customerCategory)
      .input('educationLevel', sql.NVarChar(16), profile.educationLevel)
      .input('institutionName', sql.NVarChar(150), profile.institutionName)
      .input('occupation', sql.NVarChar(100), profile.occupation)
      .query(`
        INSERT INTO [dbo].[TblClient]
          (TenantId, [Name], Mobile, BirthDate, Address, Notes, RegisterDate, CameFrom, CameFromDetails, ReferralCode, CustomerCategory, EducationLevel, InstitutionName, Occupation)
        OUTPUT
          INSERTED.ClientID, INSERTED.[Name], INSERTED.Mobile,
          INSERTED.BirthDate, INSERTED.Address, INSERTED.Notes, INSERTED.RegisterDate,
          INSERTED.CameFrom, INSERTED.CameFromDetails, INSERTED.ReferralCode,
          INSERTED.CustomerCategory, INSERTED.EducationLevel, INSERTED.InstitutionName, INSERTED.Occupation
        VALUES (@tenantId, @name, @mobile, @birthDate, @address, @notes, GETDATE(), @cameFrom, @cameFromDetails, @referralCode, @customerCategory, @educationLevel, @institutionName, @occupation)
      `);

    return NextResponse.json(result.recordset[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
