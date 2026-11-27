import {decemberProductionConfigured,decemberProductionLogin} from './releaseMode';
import {decemberPhoneSql,decemberCanonicalPhoneSql} from './phoneSql';
import 'server-only';
import type { Transaction } from 'mssql';
import { getPool,sql } from '@/lib/db';
import { evaluateDecember } from './rules';
import { normalizeEgyptianMobile } from './registration';
import { DECEMBER_CAMPAIGN_CODE } from './registrationRepository';

export class DecemberCheckoutError extends Error{
 constructor(public readonly code:string,public readonly status=409){super(code);}
}
export type DecemberCartLine={proId:number;empId:number|null;sPrice:number;qty:number;dis?:number;disVal?:number};
export type DecemberCheckoutInput={tenantId:string;branchId:number;clientId:number|null;items:readonly DecemberCartLine[]};
export type DecemberClaim={tenantId:string;expectedDiscountMinor:number};
type CampaignRow={CampaignId:string;ParticipantId:string;PhoneNormalized:string;Mobile:string;StudentVerified:number;FirstVisitPct:number;StudentPct:number;ClubPct:number;MultiServicePct:number;Friend1Pct:number;Friend2Pct:number;Friend3Pct:number;PriorSales:number;Used:number;ClubLinked:number};
const deny=(code:string):never=>{throw new DecemberCheckoutError(code);};
function minor(value:number){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>99999999.99||Math.abs(value*100-Math.round(value*100))>0.00001)deny('DECEMBER_INVALID_AMOUNT');return Math.round(value*100);}
export async function quoteDecemberInTransaction(tx:Transaction,input:DecemberCheckoutInput){
 const tenant=process.env.DECEMBER_EXAM_TENANT_ID;
 if((process.env.DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED!=='true'&&!decemberProductionConfigured())||!tenant||tenant.toLowerCase()!==input.tenantId.toLowerCase())
  throw new DecemberCheckoutError('DECEMBER_CHECKOUT_DISABLED',503);
 const ids=(process.env.DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS||'').split(',').map(Number);
 if(!ids.length||ids.length>100||ids.some(n=>!Number.isSafeInteger(n)||n<=0||n>2147483647))deny('DECEMBER_SERVICE_POLICY_REQUIRED');
 if(!input.clientId||!Number.isSafeInteger(input.clientId)||input.clientId>2147483647||input.clientId<=0||!input.items.length||input.items.length>100)deny('DECEMBER_INVALID_CART');
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,tenant).input('branch',sql.Int,input.branchId)
  .input('productionLogin',sql.NVarChar(128),decemberProductionLogin()).input('client',sql.Int,input.clientId).input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE);
 const guard=await q().query<{ok:number}>(`
 SELECT CASE WHEN ((DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent') OR (DB_NAME()=N'last132' AND @productionLogin IS NOT NULL AND SUSER_SNAME()=@productionLogin))
 AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code=N'CASHER_BOOT' AND Status=N'active')
 AND EXISTS(SELECT 1 FROM dbo.Location WHERE TenantId=@tenant AND LegacyBranchId=@branch AND Status=N'active')
 THEN 1 ELSE 0 END AS ok
 `);
 if(guard.recordset[0]?.ok!==1)throw new DecemberCheckoutError('DECEMBER_STAGING_ONLY',503);
 const row=await q().query<CampaignRow>(`
 SELECT c.CampaignId,p.ParticipantId,p.PhoneNormalized,cl.Mobile,
 CASE WHEN p.StudentVerifiedAtUtc IS NOT NULL THEN 1 ELSE 0 END StudentVerified,
 c.FirstVisitPct,c.StudentPct,c.ClubPct,c.MultiServicePct,c.Friend1Pct,c.Friend2Pct,c.Friend3Pct,
 (SELECT COUNT(*) FROM dbo.TblinvServHead h WITH(UPDLOCK,HOLDLOCK) WHERE h.ClientID=@client AND h.invType=N'مبيعات' AND ISNULL(h.isActive,N'no')=N'no') PriorSales,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.CutOfferRedemption d WITH(UPDLOCK,HOLDLOCK) WHERE d.TenantId=c.TenantId AND d.CampaignId=c.CampaignId AND d.ClientId=@client) THEN 1 ELSE 0 END Used,
 CASE WHEN EXISTS(SELECT 1 FROM dbo.CutClubMemberAccount a JOIN dbo.TblClientLoyalty l ON l.ClientID=a.LegacyClientID AND l.IsActive=1 WHERE a.TenantId=@tenant AND a.LegacyClientID=@client AND a.LinkStatus='ACTIVE' AND a.PhoneNormalized=SUBSTRING(p.PhoneNormalized,2,12) AND a.LinkApprovedAtUtc IS NOT NULL AND a.LinkApprovedBy IS NOT NULL) THEN 1 ELSE 0 END ClubLinked
 FROM dbo.CutOfferCampaign c WITH(HOLDLOCK)
 JOIN dbo.CutOfferParticipant p WITH(UPDLOCK,HOLDLOCK) ON p.TenantId=c.TenantId AND p.CampaignId=c.CampaignId
 JOIN dbo.TblClient cl WITH(HOLDLOCK) ON cl.TenantId=p.TenantId AND cl.ClientID=p.ClientId
 WHERE c.TenantId=@tenant AND c.Code=@code AND c.Status='ACTIVE'
 AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME()
 AND p.ClientId=@client AND p.IdentityVerifiedAtUtc IS NOT NULL
 `);
 const f=row.recordset[0];if(!f)return deny('DECEMBER_REGISTRATION_REQUIRED');
 if(f.Used===1)deny('DECEMBER_ALREADY_REDEEMED');
 let matches=false;try{matches=normalizeEgyptianMobile(f.Mobile)===f.PhoneNormalized;}catch{/* invalid */}
 if(!matches)deny('DECEMBER_IDENTITY_REVIEW');
 const count=await q().input('phone',sql.VarChar(16),f.PhoneNormalized).query<{n:number}>(`
 SELECT COUNT(*) n FROM dbo.TblClient WITH(HOLDLOCK)
 CROSS APPLY(SELECT ${decemberPhoneSql('Mobile')} AS clean) m
 WHERE TenantId=@tenant AND ${decemberCanonicalPhoneSql}=@phone
 `);
 if(count.recordset[0]?.n!==1)deny('DECEMBER_IDENTITY_REVIEW');
 // An active verified member link AND active loyalty record are required.
 // Unlinked/review-required accounts or inactive loyalty records do not qualify.
 const distinct=[...new Set(input.items.map(i=>i.proId))];
 if(distinct.some(id=>!Number.isSafeInteger(id)||!ids.includes(id)))deny('DECEMBER_INELIGIBLE_SERVICE');
 const catalog=await q().query<{ProID:number;SPrice1:number}>(`
 SELECT p.ProID,p.SPrice1 FROM dbo.TblPro p WITH(HOLDLOCK)
 JOIN dbo.TblCat cat ON cat.CatID=p.CatID AND cat.TenantId=p.TenantId
 WHERE p.TenantId=@tenant AND ISNULL(p.isDeleted,0)=0 AND ISNULL(cat.CatType,'')<>'pro'
 AND p.ProID IN (${distinct.join(',')})
 `);
 const prices=new Map(catalog.recordset.map(p=>[p.ProID,minor(Number(p.SPrice1))]));
 let subtotal=0;
 for(const item of input.items){
  const price=prices.get(item.proId);
  if(!price||minor(item.sPrice)!==price||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>20
   ||!Number.isSafeInteger(item.empId)||Number(item.empId)<=0||Number(item.dis??0)!==0||Number(item.disVal??0)!==0)
   deny('DECEMBER_INELIGIBLE_CART');
  subtotal+=price!*item.qty;
 }
 if(!Number.isSafeInteger(subtotal)||subtotal>9999999999)deny('DECEMBER_INVALID_AMOUNT');
 const refs=await q().input('campaign',sql.UniqueIdentifier,f.CampaignId).input('participant',sql.UniqueIdentifier,f.ParticipantId).query<{ClientId:number}>(`
 SELECT DISTINCT i.ClientId FROM dbo.CutOfferReferral r WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.CutOfferParticipant i ON i.TenantId=r.TenantId AND i.CampaignId=r.CampaignId AND i.ParticipantId=r.InviteeId
 JOIN dbo.TblinvServHead h WITH(HOLDLOCK) ON h.invID=r.InvoiceId AND h.invType=N'مبيعات' AND h.ClientID=i.ClientId
 WHERE r.TenantId=@tenant AND r.CampaignId=@campaign AND r.InviterId=@participant AND r.Status='CONFIRMED'
 AND i.IdentityVerifiedAtUtc IS NOT NULL AND ISNULL(h.isActive,N'no')=N'no' AND h.GrandTotal>0 AND h.PayDue=0
 `);
 const evaluation=evaluateDecember({active:true,registered:true,alreadyRedeemed:false,firstVisit:f.PriorSales===0,
 studentVerified:f.StudentVerified===1,clubActive:f.ClubLinked===1,eligiblePaidServiceIds:distinct.map(String),clientId:String(input.clientId),
 referrals:refs.recordset.map(r=>({clientId:String(r.ClientId),firstVisitCompleted:true,voided:false}))},
 {firstVisit:f.FirstVisitPct,student:f.StudentPct,club:f.ClubPct,multiService:f.MultiServicePct,friends:[f.Friend1Pct,f.Friend2Pct,f.Friend3Pct]},subtotal);
 if(!evaluation.discountPiasters)deny('DECEMBER_NO_DISCOUNT');
 return {...evaluation,subtotalMinor:subtotal,campaignId:f.CampaignId,participantId:f.ParticipantId,clientId:input.clientId!,tenantId:tenant};
}
export async function quoteDecember(input:DecemberCheckoutInput){
 const tx=new sql.Transaction(await getPool());await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{const quote=await quoteDecemberInTransaction(tx,input);await tx.commit();return quote;}
 catch(e){await tx.rollback().catch(()=>null);throw e;}
}
export type DecemberQuote=Awaited<ReturnType<typeof quoteDecember>>;
export async function persistDecemberRedemption(tx:Transaction,quote:DecemberQuote,invoiceId:number){
 const r=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,quote.tenantId)
 .input('campaign',sql.UniqueIdentifier,quote.campaignId).input('participant',sql.UniqueIdentifier,quote.participantId)
 .input('client',sql.Int,quote.clientId).input('invoice',sql.Int,invoiceId)
 .input('percent',sql.TinyInt,quote.percent).input('subtotal',sql.BigInt,quote.subtotalMinor).input('discount',sql.BigInt,quote.discountPiasters)
 .query(`
 INSERT dbo.CutOfferRedemption(TenantId,CampaignId,ClientId,ParticipantId,InvoiceId,PercentApplied,EligibleSubtotalMinor,DiscountMinor)
 SELECT @tenant,@campaign,@client,@participant,@invoice,@percent,@subtotal,@discount
 WHERE EXISTS(SELECT 1 FROM dbo.TblinvServHead h WHERE h.invID=@invoice AND h.invType=N'مبيعات' AND h.ClientID=@client
 AND h.SubTotal=@subtotal/100.0 AND h.DisVal=@discount/100.0 AND h.GrandTotal=(@subtotal-@discount)/100.0 AND h.PayDue=0)
 `);
 if(r.rowsAffected[0]!==1)deny('DECEMBER_REDEMPTION_CONFLICT');
}
