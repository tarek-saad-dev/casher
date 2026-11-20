import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { cutClubTenant, normalizeCutClubPhone } from '@/lib/cut-club/memberOtp';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const h={ 'Cache-Control':'private, no-store','X-Robots-Tag':'noindex' };
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:h});

/** Admin review queue: do not return legacy financial data. */
export async function GET(){
  const staff=await requireAdmin();
  if(!isAuthResult(staff)) return staff;
  try {
    const tenant=cutClubTenant();
    if(staff.tenantId.toLowerCase()!==tenant) return reply({ok:false,code:'NOT_FOUND'},404);
    const accounts=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,tenant)
      .query<{AccountID:string;PhoneNormalized:string;LinkStatus:string;AccessStatus:string;CreatedAtUtc:Date;ClientName:string|null}>(`
        SELECT TOP(200) a.AccountID,a.PhoneNormalized,a.LinkStatus,a.AccessStatus,
          a.CreatedAtUtc,c.Name AS ClientName
        FROM dbo.CutClubMemberAccount a
        LEFT JOIN dbo.TblClient c ON c.TenantId=a.TenantId AND c.ClientID=a.LegacyClientID
        WHERE a.TenantId=@tenant
        ORDER BY a.CreatedAtUtc DESC
      `);
    return reply({ok:true,items:accounts.recordset.map(x=>({
      accountId:x.AccountID,phoneMasked:x.PhoneNormalized.slice(0,4)+'****'+x.PhoneNormalized.slice(-3),
      linkStatus:x.LinkStatus,accessStatus:x.AccessStatus,
      clientName:x.ClientName?.trim()||null,createdAt:x.CreatedAtUtc,
    }))});
  }catch{return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);}
}
/**
 * A staff operator must independently establish person-to-legacy-client ownership
 * in person. OTP alone never links an old balance automatically.
 */
export async function POST(req:NextRequest){
  const trustedOrigin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
  if(req.headers.get('origin')!==trustedOrigin ||
      !req.headers.get('content-type')?.startsWith('application/json'))
    return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
  const staff=await requireAdmin();
  if(!isAuthResult(staff))return staff;
  try {
    const tenant=cutClubTenant();
    if(staff.tenantId.toLowerCase()!==tenant)return reply({ok:false,code:'NOT_FOUND'},404);
    const b=await req.json();
    if(!b||typeof b.accountId!=='string'||!/^\w{8}-[\w-]{27,36}$/.test(b.accountId)||
      !Number.isSafeInteger(b.clientId)||b.clientId<=0||
      b.proofType!=='IN_PERSON_ID' || b.confirmedInPerson!==true)
      return reply({ok:false,code:'INVALID_REVIEW_EVIDENCE'},400);
    const db=await getPool();
    const tx=new sql.Transaction(db);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{
      const account=await new sql.Request(tx)
        .input('tenant',sql.UniqueIdentifier,tenant).input('accountId',sql.UniqueIdentifier,b.accountId)
        .query<{PhoneNormalized:string;LinkStatus:string;AccessStatus:string;LegacyClientID:number|null}>(`
          SELECT PhoneNormalized,LinkStatus,AccessStatus,LegacyClientID
          FROM dbo.CutClubMemberAccount WITH (UPDLOCK,HOLDLOCK)
          WHERE TenantId=@tenant AND AccountID=@accountId
        `);
      const a=account.recordset[0];
      if(!a || a.LinkStatus==='ACTIVE' || a.AccessStatus==='SUSPENDED'){await tx.rollback();return reply({ok:false,code:'REVIEW_NOT_PENDING'},409);}
      const customer=await new sql.Request(tx)
        .input('tenant',sql.UniqueIdentifier,tenant).input('clientId',sql.Int,b.clientId)
        .query<{Mobile:string|null}>(`
          SELECT Mobile FROM dbo.TblClient WITH(HOLDLOCK)
          WHERE TenantId=@tenant AND ClientID=@clientId
        `);
      if(customer.recordset.length!==1 ||
        normalizeCutClubPhone(customer.recordset[0].Mobile)!==a.PhoneNormalized) {
        await tx.rollback();
        return reply({ok:false,code:'IDENTITY_MISMATCH'},409);
      }
      // One legacy client record can back at most one ACTIVE member wallet.
      const taken=await new sql.Request(tx)
        .input('tenant',sql.UniqueIdentifier,tenant).input('clientId',sql.Int,b.clientId)
        .input('accountId',sql.UniqueIdentifier,b.accountId)
        .query<{AccountID:string}>(`
          SELECT TOP (1) AccountID FROM dbo.CutClubMemberAccount WITH (UPDLOCK,HOLDLOCK)
          WHERE TenantId=@tenant AND LegacyClientID=@clientId AND LinkStatus='ACTIVE'
            AND AccountID<>@accountId
        `);
      if(taken.recordset.length>0){await tx.rollback();return reply({ok:false,code:'CLIENT_ALREADY_LINKED'},409);}
      const linked=await new sql.Request(tx)
        .input('tenant',sql.UniqueIdentifier,tenant).input('accountId',sql.UniqueIdentifier,b.accountId)
        .input('clientId',sql.Int,b.clientId).input('staffId',sql.Int,staff.userId)
        .query(`
          UPDATE dbo.CutClubMemberAccount
          SET LegacyClientID=@clientId,LinkStatus='ACTIVE',
              LinkApprovedAtUtc=SYSUTCDATETIME(),
              LinkApprovedBy=@staffId,LinkProofType='IN_PERSON_ID',UpdatedAtUtc=SYSUTCDATETIME()
          WHERE TenantId=@tenant AND AccountID=@accountId
            AND LinkStatus IN ('UNLINKED','REVIEW_REQUIRED') AND AccessStatus='ENABLED'
        `);
      if(linked.rowsAffected[0]!==1){await tx.rollback();return reply({ok:false,code:'REVIEW_CONFLICT'},409);}
      await tx.commit();
      return reply({ok:true,linkStatus:'ACTIVE'});
    }catch(error){await tx.rollback().catch(()=>null);throw error;}
  }catch{return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);}
}
