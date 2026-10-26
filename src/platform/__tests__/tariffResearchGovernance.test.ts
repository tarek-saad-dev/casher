import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {DRVO_MIGRATIONS} from '../../../scripts/drvo/migrations/index';
import {checksumFile} from '../../../scripts/drvo/checksum';
import {readSqlBatches} from '../../../scripts/drvo/sqlBatch';
import {
  RESEARCH_SALON_APPS,ResearchTariffError,validateTariffResearchInput,validateIndependentReview,
} from '@/platform/commercial/tariffResearchPolicy';

const sqlPath=path.join(process.cwd(),'db/drvo-migrations/019-tariff-research-review/schema.sql');
const executable=fs.readFileSync(sqlPath,'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/--.*$/gm,'');
const read=(name:string)=>fs.readFileSync(path.join(process.cwd(),name),'utf8');
const prices=Object.fromEntries(RESEARCH_SALON_APPS.map(code=>[code,1000]));
const candidate={
  industry:'salon' as const,pricingModel:'per_app' as const,appPricesMinor:prices,
  baseMonthlyMinor:0,extraBranchMonthlyMinor:19900,includedBranches:1,annualMonthsCharged:12,
};
const code=(fn:()=>unknown):string=>{
  try{fn();return 'NO_ERROR';}
  catch(e){return e instanceof ResearchTariffError?e.code:'OTHER_ERROR';}
};
describe('DRVO 019 tariff research schema integrity',()=>{
  it('registers ordered migration 19, checksum and short additive control',()=>{
    const m=DRVO_MIGRATIONS.find(x=>x.migrationKey==='tariff-research-review');
    expect(m).toMatchObject({migrationId:19,dependencies:['modular-inquiry-reviews']});
    expect(m?.checksum).toEqual(checksumFile(sqlPath));
    expect(m?.control).toMatchObject({kind:'schema',risk:'LOW',lockProfile:'short'});
    expect(readSqlBatches(sqlPath)).toHaveLength(1);
  });
  it('only creates an isolated research table without sale approvals or inserts',()=>{
    expect(executable).toContain("IF OBJECT_ID(N'dbo.ModularTariffResearchProposal',N'U') IS NULL");
    expect(executable).toContain('BEGIN TRAN');
    expect(executable).toContain('ROLLBACK TRAN');
    expect(executable).toContain('SET XACT_ABORT ON');
    expect(executable).toContain('UNIQUE (IndustryCode,Version)');
    expect(executable).toContain('ReviewedByUserId<>CreatedByUserId');
    expect(executable).toContain("N'reviewed_research'");
    expect(executable).toContain("N'changes_requested'");
    expect(executable).not.toMatch(/\b(?:UPDATE|DELETE|DROP|MERGE|INSERT)\b/i);
    expect(executable).not.toContain("N'approved'");
    for(const legacy of ['dbo.ModularPriceCatalog','dbo.TenantSubscription','dbo.TenantAppEntitlement',
      'dbo.TenantModularQuoteRequest','dbo.Invoice']){
      expect(executable).not.toContain(legacy);
    }
  });
});
describe('operator tariff research validation is not commercial pricing',()=>{
  it('accepts explicit integer piaster assumptions including zeros and conserves input',()=>{
    expect(RESEARCH_SALON_APPS).toContain('booking');
    expect(validateTariffResearchInput(candidate)).toMatchObject(candidate);
    expect(validateTariffResearchInput({...candidate,appPricesMinor:{...prices,booking:0}}).appPricesMinor.booking).toBe(0);
  });
  it('rejects unknown/missing apps, floats, unsafe amounts and invalid annual/branch terms',()=>{
    expect(code(()=>validateTariffResearchInput({...candidate,appPricesMinor:{...prices,hacking:20}}))).toBe('INCOMPLETE_APP_PRICES');
    expect(code(()=>validateTariffResearchInput({...candidate,appPricesMinor:{booking:10}}))).toBe('INCOMPLETE_APP_PRICES');
    expect(code(()=>validateTariffResearchInput({...candidate,appPricesMinor:{...prices,booking:1.5}}))).toBe('INVALID_MINOR_AMOUNT');
    expect(code(()=>validateTariffResearchInput({...candidate,baseMonthlyMinor:2**53}))).toBe('INVALID_MINOR_AMOUNT');
    expect(code(()=>validateTariffResearchInput({...candidate,annualMonthsCharged:13}))).toBe('INVALID_ANNUAL_RULE');
    expect(code(()=>validateTariffResearchInput({...candidate,includedBranches:0}))).toBe('INVALID_BRANCHES');
    expect(code(()=>validateTariffResearchInput({...candidate,industry:'supermarket' as 'salon'}))).toBe('UNSUPPORTED_INDUSTRY');
  });
  it('blocks self-review and requires a reason on independent review',()=>{
    const valid={creatorId:10,reviewerId:11,status:'submitted' as const,
      action:'reviewed_research' as const,note:'Reviewed assumptions and costs'};
    expect(validateIndependentReview(valid)).toBe(valid.note);
    expect(code(()=>validateIndependentReview({...valid,reviewerId:10}))).toBe('SEPARATION_REQUIRED');
    expect(code(()=>validateIndependentReview({...valid,note:' '}))).toBe('REVIEW_NOTE_REQUIRED');
    expect(code(()=>validateIndependentReview({...valid,status:'reviewed_research'}))).toBe('ALREADY_REVIEWED');
  });
});
describe('operator tariff research cannot become a customer purchase',()=>{
  it('gates all endpoints to platform operator and rejects caller-supplied sale/tenant fields',()=>{
    const route=read('src/app/api/admin/platform/tariff-research/route.ts');
    expect(route.match(/requirePlatformOperator\(\)/g)).toHaveLength(3);
    expect(route).toContain("auth.userId");
    expect(route).toContain('Object.keys(x).length!==allowed.length');
    expect(route).toContain("['proposalId','action','note']");
    expect(route).toContain("'Cache-Control':'no-store'");
    expect(route).not.toContain('body.tenantId');
    expect(route).not.toContain('body.amount');
    expect(route).not.toContain('createPaymentIntent');
  });
  it('records immutable revisions, serializes creation and locks review; never touches catalog/paid state',()=>{
    const service=read('src/platform/commercial/tariffResearchService.ts');
    expect(service).toContain("sp_getapplock");
    expect(service).toContain("WITH (UPDLOCK,HOLDLOCK)");
    expect(service).toContain("proposal.createdByUserId===args.actorUserId");
    expect(service).toContain("Status=N'submitted' AND CreatedByUserId<>@actor");
    expect(service).toContain('await tx.commit()');
    expect(service).toContain('scope:\'internal_research\'');
    expect(service).toContain('approvedForSale:false');
    expect(service).toContain('canIssueQuote:false');
    expect(service).not.toContain('INSERT INTO dbo.ModularPriceCatalog');
    expect(service).not.toContain('UPDATE dbo.TenantSubscription');
    expect(service).not.toContain('UPDATE dbo.TenantAppEntitlement');
    expect(service).not.toContain('calculateSalonResearchScenario');
    expect(service).not.toContain('publishPlatformOutboxEvent');
  });
  it('shows operator-only page and no official prices or checkout action',()=>{
    const page=read('src/app/platform/tariff-research/page.tsx');
    const ui=read('src/components/platform/TariffResearchClient.tsx');
    const layout=read('src/app/platform/layout.tsx');
    expect(page).toContain('requirePlatformOperator()');
    expect(layout).toContain('/platform/tariff-research');
    expect(ui).toContain('/api/admin/platform/tariff-research');
    expect(ui).toContain('مراجعة');
    expect(ui).toContain('ليست أسعار بيع معتمدة');
    expect(ui).not.toContain('تفعيل اشتراك');
  });
});
