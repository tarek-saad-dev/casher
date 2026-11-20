import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { cutClubTenant, normalizeCutClubPhone } from '@/lib/cut-club/memberOtp';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const h={ 'Cache-Control':'private, no-store','X-Robots-Tag':'noindex' };
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:h});
const accountIdRe=/^\w{8}-[\w-]{27,36}$/;

/**
 * Staff-only lookup of Casher client records whose normalized mobile equals the
 * OTP-verified phone of a pending CUT CLUB account. It replaces typing ClientID
 * by hand. It NEVER links anything: the operator still has to verify identity in
 * person and pick the right record when the phone is shared by several clients.
 * No balances are returned; only what is needed to tell duplicates apart.
 */
export async function GET(req:NextRequest){
  const staff=await requireAdmin();
  if(!isAuthResult(staff))return staff;
  try {
    const tenant=cutClubTenant();
    if(staff.tenantId.toLowerCase()!==tenant)return reply({ok:false,code:'NOT_FOUND'},404);
    const accountId=req.nextUrl.searchParams.get('accountId');
    if(!accountId||!accountIdRe.test(accountId))return reply({ok:false,code:'INVALID_REQUEST'},400);
    const db=await getPool();
    const account=await db.request()
      .input('tenant',sql.UniqueIdentifier,tenant).input('accountId',sql.UniqueIdentifier,accountId)
      .query<{PhoneNormalized:string;LinkStatus:string;AccessStatus:string}>(`
        SELECT PhoneNormalized,LinkStatus,AccessStatus FROM dbo.CutClubMemberAccount
        WHERE TenantId=@tenant AND AccountID=@accountId
      `);
    const a=account.recordset[0];
    if(!a||a.AccessStatus==='SUSPENDED'||!['UNLINKED','REVIEW_REQUIRED'].includes(a.LinkStatus))
      return reply({ok:false,code:'REVIEW_NOT_PENDING'},409);
    const rows=await db.request()
      .input('tenant',sql.UniqueIdentifier,tenant).input('phone',sql.NVarChar(20),a.PhoneNormalized)
      .query<{ClientID:number;Name:string|null;Mobile:string|null;TotalVisits:number|null;HasLoyalty:number;LinkedElsewhere:number}>(`
        SELECT TOP (20) c.ClientID,c.Name,c.Mobile,cl.TotalVisits,
          CASE WHEN cl.ClientLoyaltyID IS NULL THEN 0 ELSE 1 END AS HasLoyalty,
          CASE WHEN EXISTS (SELECT 1 FROM dbo.CutClubMemberAccount m
                            WHERE m.TenantId=@tenant AND m.LegacyClientID=c.ClientID
                              AND m.LinkStatus='ACTIVE') THEN 1 ELSE 0 END AS LinkedElsewhere
        FROM dbo.TblClient AS c
        CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          LTRIM(RTRIM(c.Mobile)), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')
          AS MobileClean) cleaned
        CROSS APPLY (SELECT CASE
          WHEN LEN(cleaned.MobileClean)=11 AND cleaned.MobileClean LIKE '01[0125]%'
            THEN '2' + cleaned.MobileClean
          WHEN LEN(cleaned.MobileClean)=14 AND cleaned.MobileClean LIKE '00201[0125]%'
            THEN SUBSTRING(cleaned.MobileClean, 3, 12)
          ELSE cleaned.MobileClean END AS Phone
        ) normalized
        LEFT JOIN dbo.TblClientLoyalty cl ON cl.ClientID=c.ClientID AND cl.IsActive=1
        WHERE c.TenantId=@tenant AND normalized.Phone=@phone
        ORDER BY c.ClientID
      `);
    // Re-check in JS with the same normalizer the POST uses, so a candidate shown
    // here can never fail the POST's IDENTITY_MISMATCH guard (or vice versa).
    const items=rows.recordset
      .filter(r=>normalizeCutClubPhone(r.Mobile)===a.PhoneNormalized)
      .map(r=>({
        clientId:r.ClientID,name:r.Name?.trim()||null,
        visits:r.TotalVisits??null,hasLoyalty:r.HasLoyalty===1,linkedElsewhere:r.LinkedElsewhere===1,
      }));
    return reply({ok:true,duplicatePhone:items.length>1,items});
  }catch{return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);}
}
