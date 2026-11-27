import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { DECEMBER_CAMPAIGN_CODE } from './registrationRepository';

/** Staging-only automatic first-visit referral confirmation, in the existing
 * sale transaction. No discount or redemption write. Allowlisted paid services
 * only; any other historical non-cancelled sale conservatively denies first visit. */
export async function confirmStagingDecemberReferral(tx:Transaction, input:{invoiceId:number;clientId:number|null;branchId:number}){
 if(process.env.DECEMBER_EXAM_STAGING_REFERRAL_ENABLED!=='true'||!input.clientId)return;
 const tenant=process.env.DECEMBER_EXAM_TENANT_ID;
 const ids=(process.env.DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS||'').split(',').map(Number);
 if(!tenant||!ids.length||ids.length>100||ids.some(n=>!Number.isSafeInteger(n)||n<=0||n>2147483647))throw Error('DECEMBER_STAGE_CONFIG_REQUIRED');
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,tenant)
  .input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).input('client',sql.Int,input.clientId)
  .input('invoice',sql.Int,input.invoiceId).input('branch',sql.Int,input.branchId);
 const guard=await q().query<{ok:number}>(`
  SELECT CASE WHEN DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent'
   AND EXISTS(SELECT 1 FROM dbo.Location WHERE TenantId=@tenant AND LegacyBranchId=@branch AND Status=N'active')
   AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code=N'CASHER_BOOT' AND Status=N'active')
   THEN 1 ELSE 0 END AS ok
 `);
 if(guard.recordset[0]?.ok!==1)throw Error('DECEMBER_STAGING_ONLY');
 const result=await q().query<{CampaignId:string;InviteeId:string;PhoneNormalized:string}>(`
 SELECT r.CampaignId,r.InviteeId,p.PhoneNormalized
 FROM dbo.CutOfferReferral r WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.CutOfferCampaign c ON c.TenantId=r.TenantId AND c.CampaignId=r.CampaignId
 JOIN dbo.CutOfferParticipant p WITH(HOLDLOCK) ON p.TenantId=r.TenantId AND p.CampaignId=r.CampaignId AND p.ParticipantId=r.InviteeId
 WHERE r.TenantId=@tenant AND c.Code=@code AND c.Status='ACTIVE' AND c.StartsAtUtc<=SYSUTCDATETIME()
   AND c.EndsAtUtc>SYSUTCDATETIME() AND p.ClientId=@client AND p.IdentityVerifiedAtUtc IS NOT NULL AND r.Status='PENDING'
 `);
 const row=result.recordset[0];if(!row)return;
 // Match canonical phone using the legacy format. Ambiguous ownership is
 // intentionally denied; there is no automated customer merge.
 const phoneCheck=await q().input('phone',sql.VarChar(16),row.PhoneNormalized).query<{Matches:number;Selected:number}>(`
 SELECT COUNT(*) AS Matches,COALESCE(SUM(CASE WHEN ClientID=@client THEN 1 ELSE 0 END),0) AS Selected
 FROM dbo.TblClient WITH(HOLDLOCK)
 CROSS APPLY(SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(Mobile)),N' ',N''),N'-',N''),N'+',N''),N'(',N''),N')',N'') AS clean) x
 WHERE TenantId=@tenant AND CASE WHEN LEN(x.clean)=11 THEN '+2'+x.clean WHEN LEN(x.clean)=14 AND LEFT(x.clean,2)='00' THEN '+'+SUBSTRING(x.clean,3,12) ELSE '+'+x.clean END=@phone
 `);
 if(phoneCheck.recordset[0]?.Matches!==1||phoneCheck.recordset[0]?.Selected!==1)return;
 const paid=await q().query<{ok:number}>(`
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM dbo.TblinvServHead h WITH(HOLDLOCK)
 JOIN dbo.TblClient cl ON cl.ClientID=h.ClientID AND cl.TenantId=@tenant
 JOIN dbo.TblinvServDetail d ON d.invID=h.invID AND d.invType=h.invType
 JOIN dbo.TblPro p ON p.ProID=d.ProID AND p.TenantId=@tenant AND ISNULL(p.isDeleted,0)=0
 WHERE h.invID=@invoice AND h.invType=N'مبيعات' AND h.ClientID=@client AND h.BranchID=@branch
 AND ISNULL(h.isActive,N'no')=N'no' AND h.GrandTotal>0 AND h.PayDue=0
 AND d.ProID IN (${ids.join(',')}) AND d.SPriceAfterDis>0
 ) AND NOT EXISTS(SELECT 1 FROM dbo.TblinvServHead WITH(UPDLOCK,HOLDLOCK)
 WHERE ClientID=@client AND invType=N'مبيعات' AND invID<>@invoice AND ISNULL(isActive,N'no')=N'no')
 THEN 1 ELSE 0 END AS ok
 `);
 if(paid.recordset[0]?.ok!==1)return;
 const updated=await q().input('campaignId',sql.UniqueIdentifier,row.CampaignId).input('invitee',sql.UniqueIdentifier,row.InviteeId).query(`
 UPDATE dbo.CutOfferReferral SET Status='CONFIRMED',InvoiceId=@invoice,ConfirmedAtUtc=SYSUTCDATETIME()
 WHERE TenantId=@tenant AND CampaignId=@campaignId AND InviteeId=@invitee AND Status='PENDING'
 `);
 if(updated.rowsAffected[0]!==1)throw Error('DECEMBER_REFERRAL_CONFLICT');
}

/** Audit-transaction guard: void unconsumed referrals on delete, block edits
 * and redeemed dependencies pending financial review. Effective even with confirmation off. */
export async function guardDecemberInvoiceMutation(tx:Transaction,invoiceId:number,mode:'edit'|'delete'='edit'){
 const probe=await new sql.Request(tx).query<{ok:number}>(`
 SELECT CASE WHEN DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent'
 AND OBJECT_ID(N'dbo.CutOfferReferral',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.CutOfferRedemption',N'U') IS NOT NULL THEN 1 ELSE 0 END AS ok
 `);
 if(probe.recordset[0]?.ok!==1)return;
 const request=()=>new sql.Request(tx).input('invoice',sql.Int,invoiceId);
 const redeemed=await request().query(`
 SELECT TOP(1) d.InvoiceId FROM dbo.CutOfferRedemption d WITH(UPDLOCK,HOLDLOCK)
 WHERE d.InvoiceId=@invoice OR EXISTS(
  SELECT 1 FROM dbo.CutOfferReferral r WITH(UPDLOCK,HOLDLOCK)
  JOIN dbo.CutOfferParticipant p ON p.TenantId=r.TenantId AND p.CampaignId=r.CampaignId AND p.ParticipantId=r.InviterId
  WHERE r.InvoiceId=@invoice AND r.Status='CONFIRMED' AND d.TenantId=r.TenantId
   AND d.CampaignId=r.CampaignId AND d.ClientId=p.ClientId)
 `);
 if(redeemed.recordset.length)throw Error('DECEMBER_INVOICE_MUTATION_REVIEW_REQUIRED');
 if(mode==='delete'){
  // If no inviter redemption exists, reverse the referral before the actual
  // invoice deletion. The outer audited transaction rolls both back on failure.
  await request().query(`
   UPDATE dbo.CutOfferReferral SET Status='VOIDED'
   WHERE InvoiceId=@invoice AND Status='CONFIRMED'
  `);
  return;
 }
 const linked=await request().query(`
 SELECT TOP(1) InvoiceId FROM dbo.CutOfferReferral WITH(UPDLOCK,HOLDLOCK) WHERE InvoiceId=@invoice AND Status='CONFIRMED'
 `);
 if(linked.recordset.length)throw Error('DECEMBER_INVOICE_MUTATION_REVIEW_REQUIRED');
}
