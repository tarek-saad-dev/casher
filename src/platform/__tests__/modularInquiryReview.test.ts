import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {DRVO_MIGRATIONS} from '../../../scripts/drvo/migrations/index';
import {checksumFile} from '../../../scripts/drvo/checksum';
import {readSqlBatches} from '../../../scripts/drvo/sqlBatch';

const sqlPath=path.join(process.cwd(),'db/drvo-migrations/018-modular-inquiry-reviews/schema.sql');
const sql=fs.readFileSync(sqlPath,'utf8');
const executable=sql.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--.*$/gm,'');
const read=(name:string)=>fs.readFileSync(path.join(process.cwd(),name),'utf8');

describe('DRVO-018 operator inquiry review migration',()=>{
  it('is 18th, checksummed, additive and depends on the unpriced inquiry table',()=>{
    const mig=DRVO_MIGRATIONS.find(x=>x.migrationKey==='modular-inquiry-reviews');
    expect(mig).toMatchObject({migrationId:18,dependencies:['modular-quote-requests']});
    expect(mig?.checksum).toBe(checksumFile(sqlPath));
    expect(mig?.control).toMatchObject({kind:'schema',risk:'LOW',lockProfile:'short'});
    expect(readSqlBatches(sqlPath)).toHaveLength(1);
    expect(executable).toContain('SET XACT_ABORT ON');
    expect(executable).toContain('BEGIN TRAN');
    expect(executable).toContain('ROLLBACK TRAN');
  });
  it('enforces tenant/request composite FK, only one review and non-paying outcomes',()=>{
    expect(executable).toContain('UX_TenantModularQuoteRequest_TenantRequest');
    expect(executable).toContain('TenantId,RequestId');
    expect(executable).toContain('UX_TenantModularInquiryReview_Request UNIQUE (RequestId)');
    expect(executable).toContain('FOREIGN KEY (TenantId,RequestId)');
    expect(executable).toContain('REFERENCES dbo.TenantModularQuoteRequest(TenantId,RequestId)');
    for(const outcome of ['follow_up_recorded','not_applicable','duplicate'])
      expect(executable).toContain("N'"+outcome+"'");
    expect(executable).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bMERGE\b/i);
    for(const str of ['TenantSubscription','TenantAppEntitlement','PriceMinor','Payment','Invoice','N\'paid\''])
      expect(executable).not.toContain(str);
  });
});
describe('DRVO-018 platform operator security and no-sale regression',()=>{
  it('requires platform operator identity on both request routes and strict input fields',()=>{
    const route=read('src/app/api/admin/platform/modular-quote-inquiries/route.ts');
    expect(route.match(/requirePlatformOperator\(\)/g)).toHaveLength(2);
    expect(route).toContain("auth.userId");
    expect(route).toContain("['requestId','outcome','note']");
    expect(route).toContain("Object.keys(b).length!==3");
    expect(route).toContain("note.length>500");
    expect(route).toContain("'Cache-Control':'no-store'");
    expect(route).not.toContain('body.tenantId');
    expect(route).not.toContain('body.amount');
    expect(route).not.toContain('quoteTenantPlan');
  });
  it('closes via tenant lock, one conditional status change and in-transaction review plus outbox',()=>{
    const service=read('src/platform/commercial/modularInquiryReviewService.ts');
    expect(service).toContain('await assertNotBootstrapTenant(tx,tenantId');
    expect(service).toContain('await acquireTenantApplock(tx,tenantId,TENANT_COMMERCIAL_LOCK_PARTS)');
    expect(service).toContain('WITH (UPDLOCK,HOLDLOCK)');
    expect(service).toContain("AND Status=N'awaiting_pricing'");
    expect(service).toContain("WHERE RequestId=@requestId AND TenantId=@tenantId");
    expect(service).toContain('INSERT INTO dbo.TenantModularInquiryReview');
    expect(service).toContain('publishPlatformOutboxEvent(tx');
    expect(service).toContain('if(prior?.Outcome!==args.outcome||prior?.Note!==note)');
    expect(service).toContain("throw new OperatorInquiryError('ALREADY_CLOSED'");
    expect(service).toContain("paid:false,quoteIssued:false,orderCreated:false,subscriptionChanged:false");
    for(const dangerous of ['UPDATE dbo.TenantSubscription','UPDATE dbo.TenantAppEntitlement',
      'INSERT INTO dbo.Invoice','calculateSalonResearchScenario','createPaymentIntent',
      'activateTenantSubscription']){
      expect(service).not.toContain(dangerous);
    }
  });
  it('shows an operator-only queue, audit outcome and no checkout actions',()=>{
    const page=read('src/app/platform/modular-quote-inquiries/page.tsx');
    const ui=read('src/components/platform/OperatorModularInquiryQueue.tsx');
    const layout=read('src/app/platform/layout.tsx');
    expect(page).toContain('requirePlatformOperator()');
    expect(layout).toContain('/platform/modular-quote-inquiries');
    expect(ui).toContain('/api/admin/platform/modular-quote-inquiries');
    expect(ui).toContain('follow_up_recorded');
    expect(ui).toContain('orderCreated!==false');
    expect(ui).not.toContain('تأكيد الدفع');
    expect(ui).not.toContain('اعتماد الاشتراك');
  });
});
