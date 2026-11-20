import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { cutClubTenant, normalizeCutClubPhone, revokeCutClubAccountSessions } from '@/lib/cut-club/memberOtp';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const h={ 'Cache-Control':'private, no-store','X-Robots-Tag':'noindex' };
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:h});
const accountIdRe=/^\w{8}-[\w-]{27,36}$/;
const mask=(p:string)=>p.slice(0,4)+'****'+p.slice(-3);

/** Support lookup: one member account by its verified phone, any status. No balances. */
export async function GET(req:NextRequest){
  const staff=await requireAdmin();
  if(!isAuthResult(staff))return staff;
  try{
    const tenant=cutClubTenant();
    if(staff.tenantId.toLowerCase()!==tenant)return reply({ok:false,code:'NOT_FOUND'},404);
    const phone=normalizeCutClubPhone(req.nextUrl.searchParams.get('phone'));
    if(!phone)return reply({ok:false,code:'INVALID_PHONE'},400);
    const r=await (await getPool()).request()
      .input('tenant',sql.UniqueIdentifier,tenant).input('phone',sql.NVarChar(20),phone)
      .query<{AccountID:string;LinkStatus:string;AccessStatus:string;LegacyClientID:number|null;ClientName:string|null;
        LinkApprovedAtUtc:Date|null;LinkApprovedBy:number|null;CreatedAtUtc:Date;LiveSessions:number}>(`
        SELECT a.AccountID,a.LinkStatus,a.AccessStatus,a.LegacyClientID,c.Name AS ClientName,
          a.LinkApprovedAtUtc,a.LinkApprovedBy,a.CreatedAtUtc,
          (SELECT COUNT(*) FROM dbo.CutClubCustomerSession s
            WHERE s.TenantId=a.TenantId AND s.AccountID=a.AccountID
              AND s.RevokedAtUtc IS NULL AND s.ExpiresAtUtc>SYSUTCDATETIME()) AS LiveSessions
        FROM dbo.CutClubMemberAccount a
        LEFT JOIN dbo.TblClient c ON c.TenantId=a.TenantId AND c.ClientID=a.LegacyClientID
        WHERE a.TenantId=@tenant AND a.PhoneNormalized=@phone
      `);
    const a=r.recordset[0];
    if(!a)return reply({ok:true,account:null});
    return reply({ok:true,account:{
      accountId:a.AccountID,phoneMasked:mask(phone),linkStatus:a.LinkStatus,accessStatus:a.AccessStatus,
      legacyClientId:a.LegacyClientID,clientName:a.ClientName?.trim()||null,
      linkApprovedAt:a.LinkApprovedAtUtc,linkApprovedBy:a.LinkApprovedBy,
      createdAt:a.CreatedAtUtc,liveSessions:a.LiveSessions,
    }});
  }catch{return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);}
}

/**
 * Support actions, each with a mandatory reason:
 *  - REVOKE_SESSIONS: sign the member out everywhere (lost phone, suspected misuse).
 *  - UNLINK: detach the legacy Casher record (wrong person linked, phone changed hands).
 *    The account returns to REVIEW_REQUIRED and every live session is revoked in the
 *    same transaction, so no open browser keeps seeing the old wallet.
 * Balances, vouchers and ledgers are never touched.
 */
export async function POST(req:NextRequest){
  const trustedOrigin=process.env.CUT_CLUB_CASHER_PUBLIC_ORIGIN ||
    (process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
  if(req.headers.get('origin')!==trustedOrigin ||
      !req.headers.get('content-type')?.startsWith('application/json'))
    return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
  const staff=await requireAdmin();
  if(!isAuthResult(staff))return staff;
  try{
    const tenant=cutClubTenant();
    if(staff.tenantId.toLowerCase()!==tenant)return reply({ok:false,code:'NOT_FOUND'},404);
    const b=await req.json().catch(()=>null);
    const reason=typeof b?.reason==='string'?b.reason.trim():'';
    if(!b||typeof b.accountId!=='string'||!accountIdRe.test(b.accountId)||
        !['UNLINK','REVOKE_SESSIONS','SUSPEND','RESUME'].includes(b.action)||reason.length<5||reason.length>300)
      return reply({ok:false,code:'INVALID_REQUEST'},400);
    const tx=new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{
      const found=await new sql.Request(tx)
        .input('tenant',sql.UniqueIdentifier,tenant).input('accountId',sql.UniqueIdentifier,b.accountId)
        .query<{LinkStatus:string;AccessStatus:string;LegacyClientID:number|null}>(`
          SELECT LinkStatus,AccessStatus,LegacyClientID FROM dbo.CutClubMemberAccount WITH (UPDLOCK,HOLDLOCK)
          WHERE TenantId=@tenant AND AccountID=@accountId
        `);
      const a=found.recordset[0];
      if(!a){await tx.rollback();return reply({ok:false,code:'NOT_FOUND'},404);}
      if(b.action==='UNLINK'){
        if(a.LinkStatus!=='ACTIVE'){await tx.rollback();return reply({ok:false,code:'NOT_LINKED'},409);}
        await new sql.Request(tx)
          .input('tenant',sql.UniqueIdentifier,tenant).input('accountId',sql.UniqueIdentifier,b.accountId)
          .query(`
            UPDATE dbo.CutClubMemberAccount
            SET LinkStatus='REVIEW_REQUIRED',LegacyClientID=NULL,LinkApprovedBy=NULL,
                LinkApprovedAtUtc=NULL,LinkProofType=NULL,UpdatedAtUtc=SYSUTCDATETIME()
            WHERE TenantId=@tenant AND AccountID=@accountId AND LinkStatus='ACTIVE'
          `);
      }
      if(b.action==='SUSPEND'||b.action==='RESUME'){
        const next=b.action==='SUSPEND'?'SUSPENDED':'ENABLED';
        if(a.AccessStatus===next){await tx.rollback();return reply({ok:false,code:'STATUS_UNCHANGED'},409);}
        const applied=await new sql.Request(tx)
          .input('tenant',sql.UniqueIdentifier,tenant).input('accountId',sql.UniqueIdentifier,b.accountId)
          .input('next',sql.VarChar(16),next).input('staffId',sql.Int,staff.userId)
          .query(`
            UPDATE dbo.CutClubMemberAccount
            SET AccessStatus=@next,AccessUpdatedAtUtc=SYSUTCDATETIME(),
              AccessUpdatedBy=@staffId,UpdatedAtUtc=SYSUTCDATETIME()
            WHERE TenantId=@tenant AND AccountID=@accountId
          `);
        if(applied.rowsAffected[0]!==1){await tx.rollback();return reply({ok:false,code:'REVIEW_CONFLICT'},409);}
        await new sql.Request(tx)
          .input('tenant',sql.UniqueIdentifier,tenant)
          .input('accountId',sql.UniqueIdentifier,b.accountId)
          .input('staffId',sql.Int,staff.userId)
          .input('action',sql.VarChar(24),b.action)
          .input('reason',sql.NVarChar(300),reason)
          .query(`
            INSERT dbo.CutClubMemberAccessAudit(TenantId,AccountID,StaffUserID,Action,Reason)
            VALUES(@tenant,@accountId,@staffId,@action,@reason)
          `);
        // Do NOT revoke the status-only session: the customer must still see
        // the explicit suspension banner at /club/home. getCutClubSession
        // removes wallet ownership on EVERY read as soon as access is suspended.
        await tx.commit();
        return reply({ok:true,action:b.action,accessStatus:next,linkStatus:a.LinkStatus});
      }
      const revoked=await revokeCutClubAccountSessions(tx,tenant,b.accountId);
      await tx.commit();
      console.info(JSON.stringify({event:'cut_club_member_support',action:b.action,
        accountId:b.accountId,previousClientId:a.LegacyClientID,staffUserId:staff.userId,
        reason,revokedSessions:revoked,at:new Date().toISOString()}));
      return reply({ok:true,action:b.action,revokedSessions:revoked,
        linkStatus:b.action==='UNLINK'?'REVIEW_REQUIRED':a.LinkStatus,accessStatus:a.AccessStatus});
    }catch(error){await tx.rollback().catch(()=>null);throw error;}
  }catch{return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);}
}
