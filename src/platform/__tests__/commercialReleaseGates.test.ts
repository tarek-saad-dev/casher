import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {RESEARCH_SALON_APPS} from '@/platform/commercial/tariffResearchPolicy';
import {DRVO_MIGRATIONS} from '../../../scripts/drvo/migrations/index';
import {checksumFile} from '../../../scripts/drvo/checksum';
import {readSqlBatches} from '../../../scripts/drvo/sqlBatch';
import {
  COMMERCIAL_RELEASE_BLOCKERS,CommercialReleaseError,
  prepareCatalogReleaseCandidate,assertNoCommercialRelease,
  type ResearchSource,
} from '@/platform/commercial/commercialReleasePolicy';
import {
  checkFutureQuoteAcceptance,checkFutureSettlementPrerequisites,
  CommercialContractError, type FutureCustomerQuote,type FuturePaymentVerification,
} from '@/platform/commercial/commercialSaleContracts';

const file=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
const pathSql='db/drvo-migrations/020-commercial-release-candidates/schema.sql';
const executable=file(pathSql).replace(/\/\*[\s\S]*?\*\//g,'').replace(/--.*$/gm,'');
const source:ResearchSource={
  proposalId:'11111111-1111-4111-8111-111111111111',industryCode:'salon',version:5,
  pricingModel:'per_app',currencyCode:'EGP',
  appPricesJson:JSON.stringify(Object.fromEntries(RESEARCH_SALON_APPS.map(code=>[code,2000]))),
  baseMonthlyMinor:'0',extraBranchMonthlyMinor:'5000',
  includedBranches:1,annualMonthsCharged:12,
  status:'reviewed_research',createdByUserId:13,
  reviewedByUserId:15,reviewedAt:'2026-10-26T00:00:00.000Z',
};
const failure=(cb:()=>unknown):string=>{
  try{cb();return 'NO_ERROR';}catch(e){
    return e instanceof CommercialReleaseError||e instanceof CommercialContractError
      ?e.code:'UNEXPECTED';
  }
};
describe('DRVO-020 commercial release candidate migration is safe',()=>{
  it('registers 020 after research, checksum and schema risk profile',()=>{
    const m=DRVO_MIGRATIONS.find(x=>x.migrationKey==='commercial-release-candidates');
    expect(m).toMatchObject({migrationId:20,dependencies:['tariff-research-review']});
    expect(m?.checksum).toBe(checksumFile(path.join(process.cwd(),pathSql)));
    expect(m?.control).toMatchObject({kind:'schema',risk:'LOW',lockProfile:'short'});
    expect(readSqlBatches(path.join(process.cwd(),pathSql))).toHaveLength(1);
    expect(executable).toContain('SET XACT_ABORT ON');
    expect(executable).toContain('BEGIN TRAN');
    expect(executable).toContain('ROLLBACK TRAN');
  });
  it('creates only non-payable, unique research-source digest refs',()=>{
    expect(executable).toContain('ModularCommercialReleaseCandidate');
    expect(executable).toContain('FOREIGN KEY(SourceProposalId)');
    expect(executable).toContain('UX_ModularCommercialReleaseCandidate_Source UNIQUE(SourceProposalId)');
    expect(executable).toContain("CHECK(Status=N'pending_policy')");
    expect(executable).toContain('SourceDigest CHAR(64) NOT NULL');
    expect(executable).not.toMatch(/\b(?:UPDATE|DELETE|DROP|MERGE|INSERT)\b/i);
    expect(executable).not.toContain("N'approved'");
    for(const name of ['dbo.TenantSubscription','dbo.ModularPriceCatalog','dbo.ModularPriceCatalogItem','dbo.TenantAppEntitlement','dbo.Invoice'])
      expect(executable).not.toContain(name);
  });
});
describe('commercial release preparation never approves a sale',()=>{
  it('produces stable SHA256 research-source digest and permanent blockers',()=>{
    const a=prepareCatalogReleaseCandidate(source);
    const b=prepareCatalogReleaseCandidate({...source});
    expect(a).toEqual(b);
    expect(a.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toMatchObject({
      state:'pending_policy',canPublish:false,canIssueCustomerQuote:false,
      canAcceptOrder:false,canCheckout:false,canActivate:false,
    });
    expect(a.blockers).toEqual(COMMERCIAL_RELEASE_BLOCKERS);
    expect(COMMERCIAL_RELEASE_BLOCKERS.length).toBeGreaterThanOrEqual(10);
    expect(failure(()=>assertNoCommercialRelease(a))).toBe('BUSINESS_APPROVAL_REQUIRED');
  });
  it('digest changes when saved source pricing changes and cannot be tampered with',()=>{
    const original=prepareCatalogReleaseCandidate(source);
    const modified=prepareCatalogReleaseCandidate({...source,appPricesJson:JSON.stringify({
      ...JSON.parse(source.appPricesJson),booking:1100,
    })});
    expect(original.sourceDigest).not.toEqual(modified.sourceDigest);
    expect(failure(()=>assertNoCommercialRelease({...original,sourceDigest:'fake'}))).toBe('INVALID_DIGEST');
  });
  it('blocks self-review, unfinished research, missing source and wrong industry',()=>{
    expect(failure(()=>prepareCatalogReleaseCandidate({...source,status:'submitted'}))).toBe('SOURCE_NOT_REVIEWED');
    expect(failure(()=>prepareCatalogReleaseCandidate({...source,reviewedByUserId:13}))).toBe('SOURCE_NOT_REVIEWED');
    expect(failure(()=>prepareCatalogReleaseCandidate({...source,reviewedByUserId:null}))).toBe('SOURCE_NOT_REVIEWED');
    expect(failure(()=>prepareCatalogReleaseCandidate({...source,industryCode:'supermarket'}))).toBe('SOURCE_UNSUPPORTED');
    expect(failure(()=>prepareCatalogReleaseCandidate({...source,baseMonthlyMinor:'-1'}))).toBe('SOURCE_INVALID');
    expect(failure(()=>prepareCatalogReleaseCandidate({...source,appPricesJson:'{}'}))).toBe('SOURCE_INVALID');
    expect(failure(()=>prepareCatalogReleaseCandidate({...source,appPricesJson:'not-json'}))).toBe('SOURCE_INVALID');
  });
  it('operator routes accept source ID only and UI never publishes prices',()=>{
    const api=file('src/app/api/admin/platform/commercial-release-candidates/route.ts');
    const svc=file('src/platform/commercial/commercialReleaseService.ts');
    const ui=file('src/components/platform/CommercialReleaseCandidatesClient.tsx');
    const layout=file('src/app/platform/layout.tsx');
    expect(api.match(/requirePlatformOperator\(\)/g)).toHaveLength(2);
    expect(api).toContain('Object.keys(b).length!==1');
    expect(api).toContain("'Cache-Control':'no-store'");
    expect(svc).toContain('WITH (UPDLOCK,HOLDLOCK)');
    expect(svc).toContain('sourceDigest!==String(r.SourceDigest)');
    expect(svc).toContain('INSERT INTO dbo.ModularCommercialReleaseCandidate');
    expect(svc).not.toContain('UPDATE dbo.ModularPriceCatalog');
    expect(svc).not.toContain('INSERT INTO dbo.TenantSubscription');
    expect(ui).toContain('/api/admin/platform/commercial-release-candidates');
    expect(ui).toContain('تجهيز الملف مش اعتماد ولا نشر للأسعار');
    expect(layout).toContain('/platform/commercial-release');
    expect(api).not.toContain('export async function PATCH');
  });
});
const quote:FutureCustomerQuote={
  quoteId:'q1',tenantId:'tenant-a',sourceCatalogDigest:'a'.repeat(64),
  status:'issued',currency:'EGP',amountMinor:99900,
  issuedAtUtc:'2026-10-26T10:00:00.000Z',
  expiresAtUtc:'2026-10-26T12:00:00.000Z',acceptedAtUtc:null,
};
const payment:FuturePaymentVerification={
  orderId:'order1',tenantId:'tenant-a',expectedAmountMinor:99900,currency:'EGP',
  providerPaymentId:'provider1',serverVerified:true,settledAmountMinor:99900,
  settlementRecorded:true,duplicateProviderEvent:false,
};
describe('future quote acceptance and payment gates stay disconnected from live selling',()=>{
  it('checks exact tenant, expiry and single acceptance before any hypothetical order',()=>{
    const verified=checkFutureQuoteAcceptance({
      quote,expectedTenantId:'tenant-a',nowUtc:'2026-10-26T11:00:00.000Z',
    });
    expect(verified).toMatchObject({wouldAllowAcceptance:true,doesNotCharge:true,doesNotCreateOrder:true});
    expect(failure(()=>checkFutureQuoteAcceptance({
      quote,expectedTenantId:'tenant-b',nowUtc:'2026-10-26T11:00:00.000Z',
    }))).toBe('TENANT_MISMATCH');
    expect(failure(()=>checkFutureQuoteAcceptance({
      quote,expectedTenantId:'tenant-a',nowUtc:'2026-10-26T12:00:00.000Z',
    }))).toBe('QUOTE_EXPIRED');
    expect(failure(()=>checkFutureQuoteAcceptance({
      quote:{...quote,status:'accepted',acceptedAtUtc:'2026-10-26T11:00:00.000Z'},
      expectedTenantId:'tenant-a',nowUtc:'2026-10-26T11:05:00.000Z',
    }))).toBe('QUOTE_NOT_OPEN');
  });
  it('refuses payment intent, unverified or mismatching settlement, and never activates',()=>{
    expect(checkFutureSettlementPrerequisites(payment)).toMatchObject({activated:false,
      eligibleForSeparateActivationReview:true});
    expect(failure(()=>checkFutureSettlementPrerequisites({...payment,serverVerified:false})))
      .toBe('PAYMENT_NOT_RECONCILED');
    expect(failure(()=>checkFutureSettlementPrerequisites({...payment,settlementRecorded:false})))
      .toBe('PAYMENT_NOT_RECONCILED');
    expect(failure(()=>checkFutureSettlementPrerequisites({...payment,duplicateProviderEvent:true})))
      .toBe('PAYMENT_NOT_RECONCILED');
    expect(failure(()=>checkFutureSettlementPrerequisites({...payment,settledAmountMinor:500})))
      .toBe('PAYMENT_NOT_RECONCILED');
    expect(failure(()=>checkFutureSettlementPrerequisites({...payment,providerPaymentId:null})))
      .toBe('PAYMENT_NOT_RECONCILED');
  });
});
