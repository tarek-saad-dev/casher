import {NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool,sql} from '@/lib/db';
import {DECEMBER_CAMPAIGN_CODE} from '@/lib/campaigns/december-exam/registrationRepository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
export async function GET(){
 const auth=await requireAdmin();if(!isAuthResult(auth))return auth;
 if(process.env.DECEMBER_EXAM_STAFF_ENABLED!=='true'||auth.tenantId.toLowerCase()!==process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase())return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 try{
 const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,auth.tenantId).input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).query(`
 SELECT CampaignId,Status FROM dbo.CutOfferCampaign WHERE TenantId=@tenant AND Code=@code;
 SELECT COUNT(*) registered,COUNT(CASE WHEN p.IdentityVerifiedAtUtc IS NOT NULL THEN 1 END) verified,
 COUNT(CASE WHEN p.IsStudent=1 THEN 1 END) students,COUNT(CASE WHEN p.StudentVerifiedAtUtc IS NOT NULL THEN 1 END) verifiedStudents
 FROM dbo.CutOfferParticipant p JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
 WHERE p.TenantId=@tenant AND c.Code=@code;
 SELECT r.Status status,COUNT(*) count FROM dbo.CutOfferReferral r JOIN dbo.CutOfferCampaign c ON c.TenantId=r.TenantId AND c.CampaignId=r.CampaignId
 WHERE r.TenantId=@tenant AND c.Code=@code GROUP BY r.Status;
 SELECT COUNT(*) redeemed,COUNT(CASE WHEN d.PercentApplied=100 THEN 1 END) freeInvoices,
 COALESCE(SUM(d.EligibleSubtotalMinor),0) grossMinor,COALESCE(SUM(d.DiscountMinor),0) discountMinor,
 COALESCE(SUM(d.EligibleSubtotalMinor-d.DiscountMinor),0) netMinor
 FROM dbo.CutOfferRedemption d JOIN dbo.CutOfferCampaign c ON c.TenantId=d.TenantId AND c.CampaignId=d.CampaignId
 JOIN dbo.TblinvServHead h ON h.invID=d.InvoiceId AND h.invType=N'مبيعات' AND h.ClientID=d.ClientId AND ISNULL(h.isActive,N'no')=N'no'
 WHERE d.TenantId=@tenant AND c.Code=@code;
 SELECT TOP(30) p.EducationType educationType,p.Institution institution,p.FacultyOrSpecialization faculty,COUNT(*) count
 FROM dbo.CutOfferParticipant p JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
 WHERE p.TenantId=@tenant AND c.Code=@code AND p.StudentVerifiedAtUtc IS NOT NULL
 GROUP BY p.EducationType,p.Institution,p.FacultyOrSpecialization ORDER BY COUNT(*) DESC;
 SELECT h.BranchID branchId,COUNT(*) redeemed,COALESCE(SUM(d.EligibleSubtotalMinor-d.DiscountMinor),0) netMinor
 FROM dbo.CutOfferRedemption d JOIN dbo.CutOfferCampaign c ON c.TenantId=d.TenantId AND c.CampaignId=d.CampaignId
 JOIN dbo.TblinvServHead h ON h.invID=d.InvoiceId AND h.invType=N'مبيعات' AND h.ClientID=d.ClientId AND ISNULL(h.isActive,N'no')=N'no'
 JOIN dbo.Location l ON l.TenantId=d.TenantId AND l.LegacyBranchId=h.BranchID
 WHERE d.TenantId=@tenant AND c.Code=@code GROUP BY h.BranchID;
 `);
 const sets=r.recordsets as unknown as Array<Array<Record<string,unknown>>>;
 if(!sets[0]?.[0])return reply({ok:false,code:'CAMPAIGN_NOT_CONFIGURED'},404);
 return reply({ok:true,status:sets[0][0].Status,participants:sets[1][0],referrals:sets[2],sales:sets[3][0],education:sets[4],branches:sets[5]});
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
