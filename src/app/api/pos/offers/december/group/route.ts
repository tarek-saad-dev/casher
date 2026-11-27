import {NextRequest,NextResponse} from 'next/server';
import {requirePageAccess,isAuthResult} from '@/lib/api-auth';
import {getPool,sql} from '@/lib/db';
import {DECEMBER_CAMPAIGN_CODE} from '@/lib/campaigns/december-exam/registrationRepository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
/** Sequential group checkout helper. Does not create, edit or pay invoices. */
export async function GET(req:NextRequest){
 const auth=await requirePageAccess('/income/pos');if(!isAuthResult(auth))return auth;
 if(process.env.DECEMBER_EXAM_POS_PREVIEW_ENABLED!=='true'||auth.tenantId.toLowerCase()!==process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase())return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const code=req.nextUrl.searchParams.get('code')?.trim().toUpperCase();
 if(!code||!/^CUT-[A-F0-9]{16}$/.test(code))return reply({ok:false,code:'INVALID_CODE'},400);
 try{
 const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,auth.tenantId).input('campaign',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).input('code',sql.VarChar(32),code).query(`
 SELECT p.ParticipantId,p.DisplayName,p.ClientId,p.IdentityVerifiedAtUtc,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.CutOfferRedemption d WHERE d.TenantId=p.TenantId AND d.CampaignId=p.CampaignId AND d.ClientId=p.ClientId) THEN 1 ELSE 0 END Used
 FROM dbo.CutOfferParticipant p JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
 WHERE p.TenantId=@tenant AND c.Code=@campaign AND p.ReferralCode=@code;
 SELECT TOP(100) i.ParticipantId,i.DisplayName,i.ClientId,i.IdentityVerifiedAtUtc,r.Status,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.TblinvServHead h WHERE h.ClientID=i.ClientId AND h.invType=N'مبيعات' AND ISNULL(h.isActive,N'no')=N'no') THEN 1 ELSE 0 END HasSale
 FROM dbo.CutOfferReferral r JOIN dbo.CutOfferParticipant p ON p.TenantId=r.TenantId AND p.CampaignId=r.CampaignId AND p.ParticipantId=r.InviterId
 JOIN dbo.CutOfferParticipant i ON i.TenantId=r.TenantId AND i.CampaignId=r.CampaignId AND i.ParticipantId=r.InviteeId
 JOIN dbo.CutOfferCampaign c ON c.TenantId=r.TenantId AND c.CampaignId=r.CampaignId
 WHERE r.TenantId=@tenant AND c.Code=@campaign AND p.ReferralCode=@code ORDER BY r.CreatedAtUtc,i.ParticipantId;
 `);
 const sets=r.recordsets as unknown as Array<Array<Record<string,unknown>>>;
 if(!sets[0]?.[0])return reply({ok:false,code:'NOT_FOUND'},404);
 return reply({ok:true,owner:sets[0][0],friends:sets[1],sequentialOnly:true});
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
