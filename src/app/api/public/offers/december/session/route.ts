import { createHash,timingSafeEqual } from 'node:crypto';
import { NextRequest,NextResponse } from 'next/server';
import { getPool,sql } from '@/lib/db';
import { campaignSessionDigest,DECEMBER_CAMPAIGN_CODE } from '@/lib/campaigns/december-exam/registrationRepository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
const digest=(v:string)=>createHash('sha256').update(v).digest();
export async function GET(req:NextRequest){
 if(process.env.DECEMBER_EXAM_INTERNAL_REGISTRATION_ENABLED!=='true')return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const key=process.env.DECEMBER_EXAM_BFF_SHARED_KEY,tenant=process.env.DECEMBER_EXAM_TENANT_ID,auth=req.headers.get('authorization');
 if(!key||Buffer.byteLength(key)<32||!tenant||!auth?.startsWith('Bearer ')||!timingSafeEqual(digest(key),digest(auth.slice(7))))
  return reply({ok:false,code:'UNAUTHORIZED'},401);
 const token=req.headers.get('x-december-session');
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return reply({ok:false,code:'SESSION_REQUIRED'},401);
 try{
  const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,tenant)
   .input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).input('digest',sql.Char(64),campaignSessionDigest(token))
   .query<{ReferralCode:string;CampaignStatus:string;Pending:number;Confirmed:number;Rejected:number}>(`
    SELECT p.ReferralCode,
      CASE WHEN c.Status='ACTIVE' AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME() THEN 'ACTIVE' ELSE 'UNAVAILABLE' END AS CampaignStatus,
      (SELECT COUNT(*) FROM dbo.CutOfferReferral r WHERE r.TenantId=p.TenantId AND r.CampaignId=p.CampaignId AND r.InviterId=p.ParticipantId AND r.Status='PENDING') AS Pending,
      (SELECT COUNT(*) FROM dbo.CutOfferReferral r WHERE r.TenantId=p.TenantId AND r.CampaignId=p.CampaignId AND r.InviterId=p.ParticipantId AND r.Status='CONFIRMED') AS Confirmed,
      (SELECT COUNT(*) FROM dbo.CutOfferReferral r WHERE r.TenantId=p.TenantId AND r.CampaignId=p.CampaignId AND r.InviterId=p.ParticipantId AND r.Status IN ('REJECTED','VOIDED')) AS Rejected
    FROM dbo.CutOfferParticipant p JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
    JOIN dbo.Tenant t ON t.TenantId=p.TenantId AND t.Status=N'active'
    WHERE p.TenantId=@tenant AND c.Code=@code AND p.SessionDigest=@digest
      AND p.CreatedAtUtc>DATEADD(day,-31,SYSUTCDATETIME())
   `);
  const p=r.recordset[0];
  if(!p)return reply({ok:false,code:'SESSION_REQUIRED'},401);
  // No phone, names, legacy client IDs, wallet, prior history or personal eligibility.
  return reply({ok:true,referralCode:p.ReferralCode,campaignStatus:p.CampaignStatus,
    counts:{pending:p.Pending,confirmed:p.Confirmed,rejected:p.Rejected}});
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
