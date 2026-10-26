import 'server-only';
import { randomUUID } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import { assertNotBootstrapTenant } from '@/platform/commercial/bootstrapGuard';
import { acquireTenantApplock, TENANT_COMMERCIAL_LOCK_PARTS } from '@/platform/tenant/tenantApplock';
import { publishPlatformOutboxEvent } from '@/platform/outbox/publisher';

export const INQUIRY_REVIEW_OUTCOMES = ['follow_up_recorded','not_applicable','duplicate'] as const;
export type InquiryReviewOutcome = (typeof INQUIRY_REVIEW_OUTCOMES)[number];

export class OperatorInquiryError extends Error {
  constructor(readonly code:string,message:string,readonly status:number=409) {
    super(message);this.name='OperatorInquiryError';
  }
}
export type OperatorQuoteInquiry = {
  requestId:string; tenantId:string;tenantCode:string;
  draftId:string;draftRevision:number; industry:string; apps:string[];
  branches:number;billingCycle:'monthly'|'annual';
  status:'awaiting_pricing'|'closed';createdAt:string;
  reviewedAt:string|null; reviewOutcome:InquiryReviewOutcome|null; reviewNote:string|null;
  // Never accidentally present an inquiry as an accepted quote/order.
  quoteAmountMinor:null; canIssueQuote:false; canAcceptOrder:false; paid:false;
};
const COLUMNS=`r.RequestId,r.TenantId,t.Code AS TenantCode,r.DraftId,r.DraftRevision,
  r.IndustryCode,r.AppsJson,r.BranchCount,r.BillingCycle,r.Status,r.CreatedAt,
  v.Outcome AS ReviewOutcome,v.Note AS ReviewNote,v.ReviewedAt`;

function shape(r:Record<string,unknown>):OperatorQuoteInquiry {
  return {
    requestId:String(r.RequestId),tenantId:String(r.TenantId),tenantCode:String(r.TenantCode),
    draftId:String(r.DraftId),draftRevision:Number(r.DraftRevision),industry:String(r.IndustryCode),
    apps:JSON.parse(String(r.AppsJson)) as string[],branches:Number(r.BranchCount),
    billingCycle:String(r.BillingCycle) as 'monthly'|'annual',
    status:String(r.Status) as 'awaiting_pricing'|'closed',
    createdAt:new Date(r.CreatedAt as string|Date).toISOString(),
    reviewedAt:r.ReviewedAt?new Date(r.ReviewedAt as string|Date).toISOString():null,
    reviewOutcome:r.ReviewOutcome?String(r.ReviewOutcome) as InquiryReviewOutcome:null,
    reviewNote:r.ReviewNote?String(r.ReviewNote):null,
    quoteAmountMinor:null,canIssueQuote:false,canAcceptOrder:false,paid:false,
  };
}
/** Platform-operator-only queue. Does not return quoted prices or customer financials. */
export async function listOperatorQuoteInquiries(
  status:'awaiting_pricing'|'closed'='awaiting_pricing',
):Promise<OperatorQuoteInquiry[]> {
  if(status!=='awaiting_pricing'&&status!=='closed')
    throw new OperatorInquiryError('STATUS_INVALID','حالة مراجعة غير مدعومة',400);
  const pool=await getPool();
  const result=await pool.request().input('status',sql.NVarChar(24),status).query(`
    SELECT TOP 100 ${COLUMNS}
    FROM dbo.TenantModularQuoteRequest r
    INNER JOIN dbo.Tenant t ON t.TenantId=r.TenantId
    LEFT JOIN dbo.TenantModularInquiryReview v
      ON v.TenantId=r.TenantId AND v.RequestId=r.RequestId
    WHERE r.Status=@status
    ORDER BY r.CreatedAt ${status==='closed'?'DESC':'ASC'},r.RequestId ASC;`);
  return (result.recordset as Record<string,unknown>[]).map(shape);
}
function assertReviewInput(outcome:InquiryReviewOutcome,note:string):string {
  if (!INQUIRY_REVIEW_OUTCOMES.includes(outcome)) {
    throw new OperatorInquiryError('OUTCOME_INVALID','نتيجة المراجعة غير صالحة',400);
  }
  if(typeof note!=='string'||!note.trim()||note.length>500) {
    throw new OperatorInquiryError('NOTE_REQUIRED','اكتب ملاحظة مراجعة من 1 إلى 500 حرف',400);
  }
  return note.trim();
}
/**
 * Closes a request as a NONPAYABLE operator follow-up only. Exactly one review per
 * request; lock serialization and status guard prevent duplicate audit/outbox rows.
 * No price catalog approval, subscription update, app install or payment action.
 */
export async function closeOperatorQuoteInquiry(args:{
  requestId:string; actorUserId:number; outcome:InquiryReviewOutcome;note:string;
}):Promise<{ok:true;status:'closed';paid:false;orderCreated:false;canCheckout:false;subscriptionChanged:false}> {
  const note=assertReviewInput(args.outcome,args.note);
  const pool=await getPool(),tx=new sql.Transaction(pool);
  await tx.begin();
  try {
    const lookup=await new sql.Request(tx)
      .input('requestId',sql.UniqueIdentifier,args.requestId)
      .query(`SELECT TenantId FROM dbo.TenantModularQuoteRequest WHERE RequestId=@requestId;`);
    const tenantId=lookup.recordset[0]?.TenantId?String(lookup.recordset[0].TenantId):null;
    if(!tenantId)throw new OperatorInquiryError('REQUEST_NOT_FOUND','الطلب غير موجود',404);
    await assertNotBootstrapTenant(tx,tenantId,'closeOperatorQuoteInquiry');
    await acquireTenantApplock(tx,tenantId,TENANT_COMMERCIAL_LOCK_PARTS);
    const found=await new sql.Request(tx).input('requestId',sql.UniqueIdentifier,args.requestId)
      .input('tenantId',sql.UniqueIdentifier,tenantId)
      .query(`SELECT Status FROM dbo.TenantModularQuoteRequest WITH (UPDLOCK,HOLDLOCK)
        WHERE RequestId=@requestId AND TenantId=@tenantId;`);
    if(!found.recordset[0])throw new OperatorInquiryError('REQUEST_NOT_FOUND','الطلب غير موجود',404);
    if(String(found.recordset[0].Status)==='closed'){
      const previous=await new sql.Request(tx).input('requestId',sql.UniqueIdentifier,args.requestId)
        .input('tenantId',sql.UniqueIdentifier,tenantId).query(`
        SELECT Outcome,Note FROM dbo.TenantModularInquiryReview
        WHERE RequestId=@requestId AND TenantId=@tenantId;`);
      const prior=previous.recordset[0] as {Outcome:string;Note:string}|undefined;
      if(prior?.Outcome!==args.outcome||prior?.Note!==note)
        throw new OperatorInquiryError('ALREADY_CLOSED','الطلب اتراجع بالفعل، حدّث القائمة',409);
      await tx.commit();
      return {ok:true,status:'closed',paid:false,orderCreated:false,
        canCheckout:false,subscriptionChanged:false}; // exact replay, no second event
    }
    if(String(found.recordset[0].Status)!=='awaiting_pricing')
      throw new OperatorInquiryError('INVALID_STATE','الطلب مش جاهز للمراجعة',409);
    const changed=await new sql.Request(tx).input('requestId',sql.UniqueIdentifier,args.requestId)
      .input('tenantId',sql.UniqueIdentifier,tenantId).query(`
      UPDATE dbo.TenantModularQuoteRequest SET Status=N'closed',UpdatedAt=SYSUTCDATETIME()
      WHERE RequestId=@requestId AND TenantId=@tenantId AND Status=N'awaiting_pricing';
      SELECT @@ROWCOUNT AS changed;`);
    if(Number(changed.recordset[0]?.changed)!==1)
      throw new OperatorInquiryError('CONFLICT','الطلب اتغير أثناء المراجعة',409);
    const reviewId=randomUUID();
    await new sql.Request(tx).input('reviewId',sql.UniqueIdentifier,reviewId)
      .input('requestId',sql.UniqueIdentifier,args.requestId)
      .input('tenantId',sql.UniqueIdentifier,tenantId)
      .input('outcome',sql.NVarChar(32),args.outcome)
      .input('note',sql.NVarChar(500),note)
      .input('actor',sql.Int,args.actorUserId).query(`
      INSERT INTO dbo.TenantModularInquiryReview
        (ReviewId,TenantId,RequestId,Outcome,Note,ReviewedByUserId)
      VALUES (@reviewId,@tenantId,@requestId,@outcome,@note,@actor);`);
    await publishPlatformOutboxEvent(tx,{
      tenantId,aggregateType:'tenant_modular_quote_inquiry',aggregateId:args.requestId,
      eventType:'tenant.modular_quote.inquiry_reviewed',
      payload:JSON.stringify({
        requestId:args.requestId,reviewId,outcome:args.outcome,actorUserId:args.actorUserId,
        paid:false,quoteIssued:false,orderCreated:false,subscriptionChanged:false,
      }),
      idempotencyKey:'modular-quote-inquiry-review:'+args.requestId,
      correlationId:'tenant:'+tenantId,occurredAt:new Date(),
    });
    await tx.commit();
    return {ok:true,status:'closed',paid:false,orderCreated:false,
      canCheckout:false,subscriptionChanged:false};
  } catch(error) {
    try{await tx.rollback();}catch{/* Preserve original error */}throw error;
  }
}
