import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { validateCustomerSource } from '@/lib/customerSource';
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
          CameFrom, CameFromDetails, ReferralCode
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
      whatsappOffersConsentConfirmed } = body;
    // A stored phone number alone is not evidence of marketing consent.
    if (whatsappOffersConsentConfirmed != null &&
        typeof whatsappOffersConsentConfirmed !== 'boolean') {
      return NextResponse.json({ error: 'تأكيد موافقة عروض واتساب غير صالح' }, { status: 400 });
    }
    const marketingConsent = whatsappOffersConsentConfirmed === true;
    const consentPhone = typeof mobile === 'string'
      ? mobile.trim().replace(/[\s()-]/g, '')
      : '';
    if (marketingConsent && !/^\+?\d{10,15}$/.test(consentPhone)) {
      return NextResponse.json({ error: 'رقم هاتف صالح مطلوب لتوثيق موافقة عروض واتساب' }, { status: 400 });
    }

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 });
    }

    const sourceValidation = validateCustomerSource(cameFrom, cameFromDetails, referralCode);
    if (cameFrom !== undefined && cameFrom !== null && cameFrom !== '' && Object.keys(sourceValidation.errors).length > 0) {
      return NextResponse.json({ error: sourceValidation.errors.cameFrom || sourceValidation.errors.cameFromDetails || sourceValidation.errors.referralCode || 'بيانات المصدر غير صالحة' }, { status: 400 });
    }

    const db = await getPool();
    if (marketingConsent) {
      const columns = await db.request().query(
        "SELECT COL_LENGTH(N'dbo.TblClient', N'OffersConsentPhone') AS HasPhone," +
        " COL_LENGTH(N'dbo.TblClient', N'OffersConsentedAtUtc') AS HasTimestamp," +
        " COL_LENGTH(N'dbo.TblClient', N'OffersConsentEvidence') AS HasEvidence"
      );
      const column = columns.recordset[0];
      if (column?.HasPhone == null || column?.HasTimestamp == null || column?.HasEvidence == null) {
        return NextResponse.json({ error: 'توثيق موافقة عروض واتساب غير جاهز على قاعدة البيانات' }, { status: 503 });
      }
    }
    const result = await db.request()
      .input('consentPhone', sql.NVarChar(30), marketingConsent ? consentPhone : null)
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('name', sql.NVarChar(100), name.trim())
      .input('mobile', sql.NVarChar(30), mobile?.trim() || null)
      .input('birthDate', sql.Date, birthDate || null)
      .input('address', sql.NVarChar(200), address?.trim() || null)
      .input('notes', sql.NVarChar(500), notes?.trim() || null)
      .input('cameFrom', sql.NVarChar(50), sourceValidation.cameFrom)
      .input('cameFromDetails', sql.NVarChar(150), sourceValidation.cameFromDetails)
      .input('referralCode', sql.NVarChar(50), sourceValidation.referralCode)
      .query(marketingConsent ? `
        INSERT INTO dbo.TblClient
          (TenantId, [Name], Mobile, BirthDate, Address, Notes, RegisterDate,
           CameFrom, CameFromDetails, ReferralCode, OffersConsentPhone,
           OffersConsentedAtUtc, OffersConsentEvidence)
        OUTPUT INSERTED.ClientID, INSERTED.[Name], INSERTED.Mobile,
          INSERTED.BirthDate, INSERTED.Address, INSERTED.Notes,
          INSERTED.RegisterDate, INSERTED.CameFrom,
          INSERTED.CameFromDetails, INSERTED.ReferralCode
        VALUES (@tenantId, @name, @mobile, @birthDate, @address, @notes,
          GETDATE(), @cameFrom, @cameFromDetails, @referralCode,
          @consentPhone, SYSUTCDATETIME(),
          N'STAFF_CONFIRMED_CUSTOMER_WHATSAPP_OFFERS')
      ` : `
        INSERT INTO dbo.TblClient
          (TenantId, [Name], Mobile, BirthDate, Address, Notes, RegisterDate,
           CameFrom, CameFromDetails, ReferralCode)
        OUTPUT INSERTED.ClientID, INSERTED.[Name], INSERTED.Mobile,
          INSERTED.BirthDate, INSERTED.Address, INSERTED.Notes,
          INSERTED.RegisterDate, INSERTED.CameFrom,
          INSERTED.CameFromDetails, INSERTED.ReferralCode
        VALUES (@tenantId, @name, @mobile, @birthDate, @address, @notes,
          GETDATE(), @cameFrom, @cameFromDetails, @referralCode)
      `);

    return NextResponse.json(result.recordset[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
