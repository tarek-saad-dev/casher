import fs from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';
import { SALON_PACK } from '@/packs/salon/public';
import { SUPERMARKET_PACK } from '@/packs/supermarket/public';
import {
  catalogCodeForPack,selectableDraftApps,validateModularDraftSelection,ModularDraftError,
} from '@/platform/commercial/modularDraftPolicy';
import { DRVO_MIGRATIONS } from '../../../scripts/drvo/migrations/index';
import { checksumFile } from '../../../scripts/drvo/checksum';
import { readSqlBatches } from '../../../scripts/drvo/sqlBatch';

const schemaPath=path.join(process.cwd(),'db/drvo-migrations/016-modular-draft-selection-catalog/schema.sql');
const schema=fs.readFileSync(schemaPath,'utf8');
const executable=schema.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--.*$/gm,'');
const read=(name:string)=>fs.readFileSync(path.join(process.cwd(),name),'utf8');
function code(fn:()=>unknown):string {
  try{fn();}catch(e){return e instanceof ModularDraftError?e.code:'UNEXPECTED';}
  return 'NO_ERROR';
}
const salon={apps:['booking','pos','queue'],branches:1,billingCycle:'monthly' as const,expectedRevision:null};

describe('DRVO 016 draft selection catalog seed',()=>{
  it('registers 16th migration as contiguous and checksummed',()=>{
    const m=DRVO_MIGRATIONS.find(x=>x.migrationKey==='modular-draft-selection-catalog');
    expect(m).toMatchObject({migrationId:16,dependencies:['modular-commercial-drafts']});
    expect(m?.checksum).toEqual(checksumFile(schemaPath));
    expect(m?.control).toMatchObject({kind:'data',risk:'LOW',lockProfile:'short'});
  });
  it('seeds only two unpriced draft catalog pointers without changing subscriptions',()=>{
    expect(readSqlBatches(schemaPath)).toHaveLength(1);
    expect(executable).toContain('SET XACT_ABORT ON');
    expect(executable).toContain('BEGIN TRAN');
    expect(executable).toContain('ROLLBACK TRAN');
    expect(executable).toContain("N'salon-selection-draft'");
    expect(executable).toContain("N'supermarket-selection-draft'");
    expect(executable).toMatch(/WITH \(UPDLOCK, HOLDLOCK\)/);
    expect(executable).toContain("N'draft'");
    expect(executable).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bMERGE\b/i);
    for(const forbidden of ['dbo.TenantSubscription','dbo.TenantAppEntitlement','dbo.ModularPriceCatalogItem']){
      expect(executable).not.toContain(forbidden);
    }
  });
});

describe('draft app selection policy',()=>{
  it('validates salon required booking and deterministic selection',()=>{
    expect(catalogCodeForPack(SALON_PACK)).toBe('salon-selection-draft');
    expect(validateModularDraftSelection(SALON_PACK,salon)).toMatchObject({
      apps:['booking','pos','queue'],branches:1,billingCycle:'monthly',expectedRevision:null,
    });
    expect(selectableDraftApps(SALON_PACK).find(x=>x.code==='booking')).toMatchObject({
      group:'required',selectable:true,
    });
  });
  it('uses supermarket required POS, not salon booking',()=>{
    expect(catalogCodeForPack(SUPERMARKET_PACK)).toBe('supermarket-selection-draft');
    expect(validateModularDraftSelection(SUPERMARKET_PACK,{
      ...salon,apps:['pos'],billingCycle:'annual',
    })).toMatchObject({apps:['pos'],billingCycle:'annual'});
    expect(code(()=>validateModularDraftSelection(SUPERMARKET_PACK,{...salon,apps:['booking']})))
      .toBe('APP_UNAVAILABLE');
  });
  it('rejects hidden/unverified, unknown, duplicate, missing required and malformed selections',()=>{
    expect(code(()=>validateModularDraftSelection(SALON_PACK,{...salon,apps:['pos']}))).toBe('REQUIRED_APP_MISSING');
    expect(code(()=>validateModularDraftSelection(SALON_PACK,{...salon,apps:['booking','booking']}))).toBe('DUPLICATE_APPS');
    for(const name of ['loyalty','ai-receptionist','messaging','inventory','purchasing','fake']){
      expect(code(()=>validateModularDraftSelection(SALON_PACK,{...salon,apps:['booking',name]}))).toBe('APP_UNAVAILABLE');
    }
    expect(code(()=>validateModularDraftSelection(SALON_PACK,{...salon,branches:0}))).toBe('INVALID_BRANCH_COUNT');
    expect(code(()=>validateModularDraftSelection(SALON_PACK,{...salon,branches:21}))).toBe('INVALID_BRANCH_COUNT');
    expect(code(()=>validateModularDraftSelection(SALON_PACK,{...salon,expectedRevision:0}))).toBe('INVALID_REVISION');
    expect(code(()=>validateModularDraftSelection(SALON_PACK,{...salon,billingCycle:'week' as 'monthly'}))).toBe('INVALID_CYCLE');
  });
});

describe('tenant draft API and transactional safety wiring',()=>{
  it('uses tenant auth on GET and PUT and rejects caller tenant, prices, paid status',()=>{
    const src=read('src/app/api/tenant/modular-draft/route.ts');
    expect(src.match(/await requireTenantBillingAdmin\(\)/g)).toHaveLength(2);
    expect(src).toContain("auth.tenantId");
    expect(src).toContain("auth.userId");
    expect(src).toContain("BOOTSTRAP_TENANT_PROTECTED");
    expect(src).toContain("['apps','branches','billingCycle','expectedRevision']");
    expect(src).not.toContain('body.tenantId');
    expect(src).not.toContain('body.price');
    expect(src).not.toContain('submitTenantPlanRequest');
    expect(src).not.toContain('changeTenantPlan');
    expect(src).toContain("'Cache-Control':'no-store'");
  });
  it('requires transactional tenant lock, version check and tenant-scoped draft apps read/delete',()=>{
    const src=read('src/platform/commercial/modularDraftService.ts');
    expect(src).toContain('assertNotBootstrapTenant(tx, args.tenantId');
    expect(src).toContain('acquireTenantApplock(tx, args.tenantId, TENANT_COMMERCIAL_LOCK_PARTS)');
    expect(src).toContain("getTenantPackState(tx, args.tenantId)");
    expect(src).toContain("validateModularDraftSelection(pack, args)");
    expect(src).toContain('WITH (UPDLOCK,HOLDLOCK)');
    expect(src).toContain("AND Revision=@expectedRevision");
    expect(src).toContain('publishPlatformOutboxEvent(tx, {');
    expect(src).toContain('INNER JOIN dbo.TenantModularDraft d ON d.DraftId=a.DraftId');
    expect(src).toContain('d.TenantId=@tenantId');
    expect(src).not.toContain('UPDATE dbo.TenantSubscription');
    expect(src).not.toContain('UPDATE dbo.TenantAppEntitlement');
    expect(src).not.toContain('paymentProvider');
    expect(src).toContain('paid:false,subscriptionChanged:false,installedAppsChanged:false');
  });
  it('links customer billing screen to draft editor but retains history',()=>{
    const ui=read('src/components/tenant/TenantBillingClient.tsx');
    expect(ui).toContain('<ModularDraftClient />');
    expect(ui).toContain('data.requests.map');
    const child=read('src/components/tenant/ModularDraftClient.tsx');
    expect(child).toContain('/api/tenant/modular-draft');
    expect(child).toContain("method:'PUT'");
    expect(child).toContain('expectedRevision:data.draft?.revision ?? null');
    expect(child).toContain('مفيش دفع');
  });
});
