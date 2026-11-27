import { NextRequest,NextResponse } from 'next/server';
import { requirePageAccess,isAuthResult } from '@/lib/api-auth';
import { getPool,sql } from '@/lib/db';
import { DECEMBER_CAMPAIGN_CODE } from '@/lib/campaigns/december-exam/registrationRepository';
import { normalizeEgyptianMobile } from '@/lib/campaigns/december-exam/registration';
import { evaluateDecember } from '@/lib/campaigns/december-exam/rules';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
type Facts={FirstVisitPct:number;StudentPct:number;ClubPct:number;MultiServicePct:number;Friend1Pct:number;Friend2Pct:number;Friend3Pct:number;
 Mobile:string|null;PhoneNormalized:string|null;Active:number;Registered:number;Used:number;PriorSales:number;PhoneMatches:number;StudentVerified:number;ClubLinked:number;Confirmed:number;Pending:number};
export async function GET(req:NextRequest){
 if(process.env.DECEMBER_EXAM_POS_PREVIEW_ENABLED!=='true')return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const auth=await requirePageAccess('/income/pos');if(!isAuthResult(auth))return auth;
 if(auth.tenantId.toLowerCase()!==process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase())return reply({ok:false,code:'NOT_FOUND'},404);
 const raw=req.nextUrl.searchParams.get('clientId')||'',client=Number(raw);
 if(!/^\d{1,10}$/.test(raw)||!Number.isSafeInteger(client)||client<=0||client>2147483647)return reply({ok:false,code:'INVALID_CLIENT'},400);
 try{
 const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,auth.tenantId).input('client',sql.Int,client)
 .input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).query<Facts>(`
 SELECT cl.Mobile,p.PhoneNormalized,c.FirstVisitPct,c.StudentPct,c.ClubPct,c.MultiServicePct,c.Friend1Pct,c.Friend2Pct,c.Friend3Pct,
 CASE WHEN c.Status='ACTIVE' AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME() THEN 1 ELSE 0 END Active,
 CASE WHEN p.IdentityVerifiedAtUtc IS NOT NULL THEN 1 ELSE 0 END Registered,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.CutOfferRedemption d WHERE d.TenantId=c.TenantId AND d.CampaignId=c.CampaignId AND d.ClientId=@client) THEN 1 ELSE 0 END Used,
 (SELECT COUNT(*) FROM dbo.TblinvServHead h WHERE h.ClientID=@client AND h.invType=N'مبيعات' AND ISNULL(h.isActive,N'no')=N'no') PriorSales,
 (SELECT COUNT(*) FROM dbo.TblClient x
 CROSS APPLY(SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(x.Mobile)),N' ',N''),N'-',N''),N'+',N''),N'(',N''),N')',N'') clean) m
 WHERE x.TenantId=@tenant AND CASE WHEN LEN(m.clean)=11 THEN '+2'+m.clean WHEN LEN(m.clean)=14 AND LEFT(m.clean,2)='00' THEN '+'+SUBSTRING(m.clean,3,12) ELSE '+'+m.clean END=p.PhoneNormalized) PhoneMatches,
 CASE WHEN p.StudentVerifiedAtUtc IS NOT NULL THEN 1 ELSE 0 END StudentVerified,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.CutClubMemberAccount a JOIN dbo.TblClientLoyalty l ON l.ClientID=a.LegacyClientID AND l.IsActive=1
 WHERE a.TenantId=@tenant AND a.LegacyClientID=@client AND a.LinkStatus='ACTIVE') THEN 1 ELSE 0 END ClubLinked,
 (SELECT COUNT(*) FROM dbo.CutOfferReferral r JOIN dbo.CutOfferParticipant i ON i.TenantId=r.TenantId AND i.CampaignId=r.CampaignId AND i.ParticipantId=r.InviteeId
 JOIN dbo.TblinvServHead h ON h.invID=r.InvoiceId AND h.invType=N'مبيعات' AND h.ClientID=i.ClientId AND ISNULL(h.isActive,N'no')=N'no'
 WHERE r.TenantId=c.TenantId AND r.CampaignId=c.CampaignId AND r.InviterId=p.ParticipantId AND r.Status='CONFIRMED') Confirmed,
 (SELECT COUNT(*) FROM dbo.CutOfferReferral r WHERE r.TenantId=c.TenantId AND r.CampaignId=c.CampaignId AND r.InviterId=p.ParticipantId AND r.Status='PENDING') Pending
 FROM dbo.CutOfferCampaign c JOIN dbo.TblClient cl ON cl.TenantId=c.TenantId AND cl.ClientID=@client
 LEFT JOIN dbo.CutOfferParticipant p ON p.TenantId=c.TenantId AND p.CampaignId=c.CampaignId AND p.ClientId=cl.ClientID
 WHERE c.TenantId=@tenant AND c.Code=@code
 `);
 const f=r.recordset[0];if(!f)return reply({ok:false,code:'NOT_FOUND'},404);
 let matchesSelected=false;
 try{matchesSelected=normalizeEgyptianMobile(f.Mobile)===f.PhoneNormalized;}catch{/* invalid legacy phone */}
 const registered=f.Registered===1&&f.PhoneMatches===1&&matchesSelected;
 // Club and cart service rules stay excluded until authoritative suspension/catalog
 // policies are verified; expose observed link only, not granted eligibility.
 const evaluation=evaluateDecember({active:f.Active===1,registered,alreadyRedeemed:f.Used===1,
 firstVisit:f.PriorSales===0,studentVerified:f.StudentVerified===1,clubActive:false,eligiblePaidServiceIds:[],
 clientId:String(client),referrals:Array.from({length:Math.min(3,f.Confirmed)},(_,i)=>({clientId:'confirmed-'+i,firstVisitCompleted:true,voided:false}))},
 {firstVisit:f.FirstVisitPct,student:f.StudentPct,club:f.ClubPct,multiService:f.MultiServicePct,friends:[f.Friend1Pct,f.Friend2Pct,f.Friend3Pct]},0);
 return reply({ok:true,previewOnly:true,active:f.Active===1,registered,identityReview:f.Registered===1&&!registered,alreadyRedeemed:f.Used===1,
 firstVisit:registered&&f.PriorSales===0,studentVerified:registered&&f.StudentVerified===1,clubLinked:f.ClubLinked===1,
 confirmed:f.Confirmed,pending:f.Pending,partialPercent:evaluation.percent,rules:evaluation.rules,reason:evaluation.reason});
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
