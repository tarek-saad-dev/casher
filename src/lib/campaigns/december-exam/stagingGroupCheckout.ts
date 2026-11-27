import 'server-only';
import type {Transaction} from 'mssql';
import {sql} from '@/lib/db';
import {executeLegacySaleCreateTransaction,type LegacySaleCreateTransactionInput,type LegacySaleCreateTransactionResult} from '@/apps/pos/internal/legacySaleCreateAdapter';
import {DecemberCheckoutError,quoteDecemberInTransaction} from './stagingCheckout';
import {DECEMBER_CAMPAIGN_CODE} from './registrationRepository';
type GroupInput={tenantId:string;owner:LegacySaleCreateTransactionInput;friends:LegacySaleCreateTransactionInput[]};
const deny=(code:string):never=>{throw new DecemberCheckoutError(code);};
/** Internal staging-only primitive. Caller owns serializable transaction and MUST
 * roll back on any failure; no HTTP exposure or post-commit effects here.
 * All inputs must be server-built, not raw browser payloads. */
export async function executeStagingDecemberGroup(tx:Transaction,input:GroupInput):Promise<LegacySaleCreateTransactionResult[]>{
 if(process.env.DECEMBER_EXAM_STAGING_GROUP_ENABLED!=='true'||process.env.DECEMBER_EXAM_STAGING_REFERRAL_ENABLED!=='true'||process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase()!==input.tenantId.toLowerCase())deny('DECEMBER_GROUP_DISABLED');
 const {owner,friends,tenantId}=input,all=[...friends,owner];
 if(friends.length<1||friends.length>10||new Set(all.map(x=>x.clientId)).size!==all.length||all.some(x=>!x.clientId||!Number.isSafeInteger(x.clientId)||x.clientId<=0||x.branchId!==owner.branchId||x.businessDayId!==owner.businessDayId||x.shiftMoveID!==owner.shiftMoveID||x.userID!==owner.userID||!x.decemberClaim||x.decemberClaim.tenantId!==tenantId))deny('DECEMBER_GROUP_INVALID');
 const guard=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,tenantId).query("SELECT CASE WHEN DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent' AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code=N'CASHER_BOOT' AND Status=N'active') THEN 1 ELSE 0 END ok");
 if(guard.recordset[0]?.ok!==1)deny('DECEMBER_STAGING_ONLY');
 const relation=async(friend:number,status:string)=>{
  const r=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,tenantId).input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).input('owner',sql.Int,owner.clientId).input('friend',sql.Int,friend).input('status',sql.VarChar(12),status).query(`
   SELECT r.InvoiceId FROM dbo.CutOfferReferral r WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.CutOfferCampaign c WITH(HOLDLOCK) ON c.TenantId=r.TenantId AND c.CampaignId=r.CampaignId
   JOIN dbo.CutOfferParticipant p WITH(UPDLOCK,HOLDLOCK) ON p.TenantId=r.TenantId AND p.CampaignId=r.CampaignId AND p.ParticipantId=r.InviterId
   JOIN dbo.CutOfferParticipant i WITH(UPDLOCK,HOLDLOCK) ON i.TenantId=r.TenantId AND i.CampaignId=r.CampaignId AND i.ParticipantId=r.InviteeId
   WHERE r.TenantId=@tenant AND c.Code=@code AND c.Status='ACTIVE' AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME()
   AND p.ClientId=@owner AND i.ClientId=@friend AND p.IdentityVerifiedAtUtc IS NOT NULL AND i.IdentityVerifiedAtUtc IS NOT NULL AND r.Status=@status
  `);return r.recordset;
 };
 // Validate all links before the first write. The owner quote is recomputed
 // AFTER friends' invoices are confirmed in the very same transaction.
 for(const friend of friends)if((await relation(friend.clientId!,'PENDING')).length!==1)deny('DECEMBER_GROUP_LINK_REQUIRED');
 const results:LegacySaleCreateTransactionResult[]=[];
 for(const member of all){
  const quote=await quoteDecemberInTransaction(tx,{tenantId,branchId:member.branchId,clientId:member.clientId,items:member.items});
  if(quote.discountPiasters!==member.decemberClaim!.expectedDiscountMinor)deny('DECEMBER_GROUP_QUOTE_CHANGED');
  if(member!==owner&&(quote.payablePiasters<=0||!quote.rules.some(r=>r.code==='FIRST_VISIT')))deny('DECEMBER_GROUP_PAID_FIRST_VISIT_REQUIRED');
  const allocations=member.activeAllocations;
  if(member.isSplitPayment||member.payCash!==0||member.payVisa!==0||allocations.length!==(quote.payablePiasters?1:0))deny('DECEMBER_GROUP_PAYMENT_INVALID');
  if(allocations.length){
   const a=allocations[0];
   if(!Number.isFinite(a.amount)||Math.round(a.amount*100)!==quote.payablePiasters||a.paymentMethodId!==member.headerPaymentMethodId||a.paymentMethodId===member.splitCfg.clearingMethodId)deny('DECEMBER_GROUP_PAYMENT_INVALID');
   const method=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,tenantId).input('method',sql.Int,a.paymentMethodId).query("SELECT PaymentID FROM dbo.TblPaymentMethods WHERE TenantId=@tenant AND PaymentID=@method AND PaymentMethod<>N'بدون تحصيل - عرض ديسمبر'");
   if(method.recordset.length!==1)deny('DECEMBER_GROUP_PAYMENT_INVALID');
  }
  const result=await executeLegacySaleCreateTransaction(tx,member);results.push(result);
  if(member!==owner){const confirmed=await relation(member.clientId!,'CONFIRMED');if(confirmed.length!==1||confirmed[0].InvoiceId!==result.invID)deny('DECEMBER_GROUP_REFERRAL_NOT_CONFIRMED');}
 }
 return results;
}
