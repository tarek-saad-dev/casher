import 'server-only';
import {randomUUID} from 'node:crypto';
import {getPool,sql} from '@/lib/db';
import {assertNotBootstrapTenant} from '@/platform/commercial/bootstrapGuard';
import {acquireTenantApplock,TENANT_COMMERCIAL_LOCK_PARTS} from '@/platform/tenant/tenantApplock';
import {publishPlatformOutboxEvent} from '@/platform/outbox/publisher';

export class ModularInquiryError extends Error {
  constructor(readonly code:string,message:string,readonly status=409){super(message);this.name='ModularInquiryError';}
}
export type QuoteInquiry={requestId:string;draftId:string;draftRevision:number;apps:string[];
  branches:number;billingCycle:'monthly'|'annual';status:'awaiting_pricing'|'closed';createdAt:string;
  amountEgp:null;paid:false;orderCreated:false;canCheckout:false;};

function shape(r:Record<string,unknown>):QuoteInquiry {
  return {requestId:String(r.RequestId),draftId:String(r.DraftId),draftRevision:Number(r.DraftRevision),
    apps:JSON.parse(String(r.AppsJson)) as string[],branches:Number(r.BranchCount),
    billingCycle:String(r.BillingCycle) as 'monthly'|'annual',
    status:String(r.Status) as 'awaiting_pricing'|'closed',
    createdAt:new Date(r.CreatedAt as string|Date).toISOString(),
    amountEgp:null,paid:false,orderCreated:false,canCheckout:false};
}
const COLUMNS='RequestId,DraftId,DraftRevision,AppsJson,BranchCount,BillingCycle,Status,CreatedAt';
export async function listTenantQuoteInquiries(tenantId:string):Promise<QuoteInquiry[]> {
  const pool=await getPool();
  const r=await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId).query(`
    SELECT TOP 20 ${COLUMNS} FROM dbo.TenantModularQuoteRequest
    WHERE TenantId=@tenantId ORDER BY CreatedAt DESC,RequestId DESC;`);
  return (r.recordset as Record<string,unknown>[]).map(shape);
}
/**
 * Snapshot the current draft under the same tenant commercial lock as draft saves.
 * Explicitly no pricing calculation, order, subscription update or app install.
 * Existing draft revision yields the same request (idempotent).
 */
export async function requestModularPricing(args:{tenantId:string;actorUserId:number;expectedDraftRevision:number}):Promise<QuoteInquiry> {
  const pool=await getPool(),tx=new sql.Transaction(pool);await tx.begin();
  try {
    await assertNotBootstrapTenant(tx,args.tenantId,'requestModularPricing');
    await acquireTenantApplock(tx,args.tenantId,TENANT_COMMERCIAL_LOCK_PARTS);
    const draft=await new sql.Request(tx).input('tenantId',sql.UniqueIdentifier,args.tenantId)
      .query(`SELECT TOP 1 d.DraftId,d.Revision,d.CatalogId,d.BranchCount,d.BillingCycle,c.IndustryCode
        FROM dbo.TenantModularDraft d WITH (UPDLOCK,HOLDLOCK)
        INNER JOIN dbo.ModularPriceCatalog c ON c.CatalogId=d.CatalogId
        INNER JOIN dbo.TenantIndustryPack p ON p.TenantId=d.TenantId AND p.PackCode=c.IndustryCode
        WHERE d.TenantId=@tenantId AND d.Status=N'draft' AND c.Status=N'draft';`);
    const d=draft.recordset[0] as Record<string,unknown>|undefined;
    if(!d)throw new ModularInquiryError('DRAFT_REQUIRED','احفظ اختيارات التطبيقات الأول.');
    if(Number(d.Revision)!==args.expectedDraftRevision)
      throw new ModularInquiryError('REVISION_CONFLICT','اختياراتك اتغيرت. حدّث الصفحة الأول.');
    const existing=await new sql.Request(tx).input('tenantId',sql.UniqueIdentifier,args.tenantId)
      .input('draftId',sql.UniqueIdentifier,String(d.DraftId)).input('rev',sql.Int,Number(d.Revision))
      .query(`SELECT ${COLUMNS} FROM dbo.TenantModularQuoteRequest WITH (UPDLOCK,HOLDLOCK)
        WHERE TenantId=@tenantId AND DraftId=@draftId AND DraftRevision=@rev;`);
    if(existing.recordset[0]) {
      const result=shape(existing.recordset[0] as Record<string,unknown>);
      await tx.commit();return result;
    }
    const appRows=await new sql.Request(tx).input('tenantId',sql.UniqueIdentifier,args.tenantId)
      .input('draftId',sql.UniqueIdentifier,String(d.DraftId)).query(`
      SELECT a.AppCode FROM dbo.TenantModularDraftApp a
      INNER JOIN dbo.TenantModularDraft d ON d.DraftId=a.DraftId
      WHERE d.TenantId=@tenantId AND d.DraftId=@draftId AND d.Status=N'draft'
      ORDER BY a.AppCode;`);
    const apps=(appRows.recordset as Array<{AppCode:string}>).map(x=>String(x.AppCode));
    if(!apps.length)throw new ModularInquiryError('EMPTY_DRAFT','اختار تطبيقات الأول.');
    const requestId=randomUUID();
    const result=await new sql.Request(tx).input('requestId',sql.UniqueIdentifier,requestId)
      .input('tenantId',sql.UniqueIdentifier,args.tenantId)
      .input('draftId',sql.UniqueIdentifier,String(d.DraftId))
      .input('revision',sql.Int,Number(d.Revision))
      .input('catalogId',sql.UniqueIdentifier,String(d.CatalogId))
      .input('industry',sql.NVarChar(32),String(d.IndustryCode))
      .input('apps',sql.NVarChar(sql.MAX),JSON.stringify(apps))
      .input('branches',sql.Int,Number(d.BranchCount))
      .input('cycle',sql.NVarChar(10),String(d.BillingCycle))
      .input('actor',sql.Int,args.actorUserId).query(`
      INSERT INTO dbo.TenantModularQuoteRequest
        (RequestId,TenantId,DraftId,DraftRevision,CatalogId,IndustryCode,AppsJson,BranchCount,BillingCycle,RequestedByUserId)
      VALUES (@requestId,@tenantId,@draftId,@revision,@catalogId,@industry,@apps,@branches,@cycle,@actor);
      SELECT ${COLUMNS} FROM dbo.TenantModularQuoteRequest WHERE TenantId=@tenantId AND RequestId=@requestId;`);
    await publishPlatformOutboxEvent(tx,{
      tenantId:args.tenantId,aggregateType:'tenant_modular_quote_inquiry',aggregateId:requestId,
      eventType:'tenant.modular_quote.inquiry_requested',
      payload:JSON.stringify({requestId,draftId:String(d.DraftId),draftRevision:Number(d.Revision),
        apps,paid:false,amount:null,orderCreated:false,subscriptionChanged:false}),
      idempotencyKey:'modular-quote-inquiry:'+requestId,correlationId:'tenant:'+args.tenantId,
      occurredAt:new Date(),
    });
    const response=shape(result.recordset[0] as Record<string,unknown>);
    await tx.commit();return response;
  }catch(err){try{await tx.rollback();}catch{/* retain original error */}throw err;}
}
