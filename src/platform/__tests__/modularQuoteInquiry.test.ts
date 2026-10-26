import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {DRVO_MIGRATIONS} from '../../../scripts/drvo/migrations/index';
import {checksumFile} from '../../../scripts/drvo/checksum';
import {readSqlBatches} from '../../../scripts/drvo/sqlBatch';

const name='db/drvo-migrations/017-modular-quote-requests/schema.sql';
const sqlText=fs.readFileSync(path.join(process.cwd(),name),'utf8');
const executable=sqlText.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--.*$/gm,'');
const read=(s:string)=>fs.readFileSync(path.join(process.cwd(),s),'utf8');
describe('quote inquiry migration 017 - not payment or priced order',()=>{
  it('is registered with checksum and additive controls',()=>{
    const m=DRVO_MIGRATIONS.find(x=>x.migrationKey==='modular-quote-requests');
    expect(m).toMatchObject({migrationId:17,dependencies:['modular-draft-selection-catalog']});
    expect(m?.checksum).toBe(checksumFile(path.join(process.cwd(),name)));
    expect(m?.control).toMatchObject({kind:'schema',risk:'LOW'});
  });
  it('uses tenant + draft revision for idempotency, without money, orders or paid statuses',()=>{
    expect(readSqlBatches(path.join(process.cwd(),name))).toHaveLength(1);
    expect(executable).toContain('UX_TenantModularQuoteRequest_DraftRevision');
    expect(executable).toContain('UNIQUE (TenantId,DraftId,DraftRevision)');
    expect(executable).toContain('ISJSON(AppsJson)=1');
    expect(executable).toContain("N'awaiting_pricing'");
    expect(executable).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bMERGE\b/i);
    expect(executable).not.toContain('AmountMinor');
    expect(executable).not.toContain("N'paid'");
    expect(executable).not.toContain('dbo.TenantSubscription');
    expect(executable).not.toContain('dbo.TenantAppEntitlement');
  });
  it('has scoped authenticated API, guarded transactions and no caller prices',()=>{
    const route=read('src/app/api/tenant/modular-quote-inquiries/route.ts');
    const svc=read('src/platform/commercial/modularQuoteInquiryService.ts');
    expect(route.match(/requireTenantBillingAdmin\(\)/g)).toHaveLength(2);
    expect(route).toContain("Object.keys(body).length!==1");
    expect(route).toContain("expectedDraftRevision");
    expect(route).toContain("auth.tenantId");
    expect(route).not.toContain('body.amount');
    expect(route).not.toContain('body.tenantId');
    expect(svc).toContain('assertNotBootstrapTenant(tx,args.tenantId');
    expect(svc).toContain('acquireTenantApplock(tx,args.tenantId,TENANT_COMMERCIAL_LOCK_PARTS)');
    expect(svc).toContain('WITH (UPDLOCK,HOLDLOCK)');
    expect(svc).toContain('d.TenantId=@tenantId');
    expect(svc).toContain('publishPlatformOutboxEvent(tx');
    expect(svc).not.toContain('changeTenantPlan');
    expect(svc).not.toContain('installTenantApp');
  });
});
