import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {DRVO_MIGRATIONS} from '../../../scripts/drvo/migrations/index';
import {checksumFile} from '../../../scripts/drvo/checksum';
import {readSqlBatches} from '../../../scripts/drvo/sqlBatch';
import {
  InternalQuoteSnapshotError,INTERNAL_SNAPSHOT_TTL_HOURS,makeInternalQuoteSnapshot,
  verifyInternalQuoteSnapshot,type InternalQuoteSnapshotSource,
} from '@/platform/commercial/internalQuoteSnapshotPolicy';
import {simulateModularResearchInquiry,type ResearchInquirySnapshot,type ReviewedTariffSnapshot} from '@/platform/commercial/modularQuoteLab';
import {RESEARCH_SALON_APPS} from '@/platform/commercial/tariffResearchPolicy';

const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
const schema='db/drvo-migrations/022-internal-quote-snapshots/schema.sql';
const executable=read(schema).replace(/\/\*[\s\S]*?\*\//g,'').replace(/--.*$/gm,'');
const uuid=(code:string)=>code.repeat(8)+'-'+code.repeat(4)+'-4'+code.repeat(3)+'-8'+code.repeat(3)+'-'+code.repeat(12);
const inquiry:ResearchInquirySnapshot={
  requestId:uuid('1'),tenantId:uuid('2'),tenantCode:'TEST_ONLY',
  status:'awaiting_pricing',industry:'salon',draftRevision:3,
  apps:['booking','pos'],branches:2,billingCycle:'annual',
};
const proposal:ReviewedTariffSnapshot={
  proposalId:uuid('3'),industry:'salon',version:2,status:'reviewed_research',
  createdByUserId:1,reviewedByUserId:2,reviewedAt:'2026-10-26T05:00:00.000Z',
  reviewNote:'independent research check',
  pricingModel:'per_app',appPricesMinor:Object.fromEntries(RESEARCH_SALON_APPS.map(k=>[k,1000])),
  baseMonthlyMinor:0,extraBranchMonthlyMinor:500,includedBranches:1,
  annualMonthsCharged:10,currency:'EGP',
};
const source:InternalQuoteSnapshotSource={
  requestId:inquiry.requestId,tenantId:inquiry.tenantId,candidateId:uuid('4'),
  sourceDigest:'a'.repeat(64),researchVersion:proposal.version,draftRevision:inquiry.draftRevision,
  simulation:simulateModularResearchInquiry(inquiry,proposal),
};
const createdAt='2026-10-26T05:00:00.000Z';
const create=()=>makeInternalQuoteSnapshot({snapshotId:uuid('5'),source,createdAt});
function fail(fn:()=>unknown){
 try{fn();return 'NO_ERROR';}catch(e){return e instanceof InternalQuoteSnapshotError?e.code:'OTHER_ERROR';}
}
describe('DRVO-022 immutable internal-only research quote snapshot migration',()=>{
 it('registers 22 after evidence with checksum and short additive schema',()=>{
  const m=DRVO_MIGRATIONS.find(x=>x.migrationKey==='internal-quote-snapshots');
  expect(m).toMatchObject({migrationId:22,dependencies:['commercial-policy-evidence','modular-inquiry-reviews']});
  expect(m?.checksum).toBe(checksumFile(path.join(process.cwd(),schema)));
  expect(m?.control).toMatchObject({kind:'schema',risk:'LOW',lockProfile:'short'});
  expect(readSqlBatches(path.join(process.cwd(),schema))).toHaveLength(1);
  expect(executable).toContain('SET XACT_ABORT ON');
  expect(executable).toContain('BEGIN TRAN');
  expect(executable).toContain('ROLLBACK TRAN');
 });
 it('schema enforces composite tenant/request ownership, fixed internal-only status and expiry',()=>{
  expect(executable).toContain('UNIQUE (TenantId,RequestId,CandidateId)');
  expect(executable).toContain('FOREIGN KEY (TenantId,RequestId)');
  expect(executable).toContain('REFERENCES dbo.TenantModularQuoteRequest(TenantId,RequestId)');
  expect(executable).toContain('REFERENCES dbo.ModularCommercialReleaseCandidate(CandidateId)');
  expect(executable).toContain("CHECK (Status=N'internal_only')");
  expect(executable).toContain('DATEADD(HOUR,48,CreatedAt)');
  expect(executable).toContain('ISJSON(ResearchQuoteJson)=1');
  expect(executable).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|MERGE)\b/i);
  for(const forbidden of ['dbo.ModularPriceCatalog','dbo.TenantSubscription','dbo.TenantAppEntitlement','dbo.Invoice'])
   expect(executable).not.toContain(forbidden);
 });
});
describe('cryptographically digested snapshot research-only policy',()=>{
 it('produces identical deterministic hash, 48h validity and no sale flags',()=>{
  const a=create(),b=create();
  expect(a).toEqual(b);
  expect(INTERNAL_SNAPSHOT_TTL_HOURS).toBe(48);
  expect(a).toMatchObject({status:'internal_only',availability:'internal_current',
    canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false,
    canActivate:false,paid:false,orderCreated:false,
    researchVersion:2,draftRevision:3});
  expect(a.quoteDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(a.expiresAt).toBe('2026-10-28T05:00:00.000Z');
  expect(a.researchQuote.totalMonthlyMinor).toBe(2500);
  expect(a.researchQuote.totalPeriodMinor).toBe(25000);
 });
 it('expires at boundary and remains available for internal audit only',()=>{
  const snap=create();
  expect(verifyInternalQuoteSnapshot(snap,'2026-10-28T04:59:59.000Z')
    .availability).toBe('internal_current');
  expect(verifyInternalQuoteSnapshot(snap,'2026-10-28T05:00:00.000Z')
    .availability).toBe('internal_expired');
  expect(verifyInternalQuoteSnapshot(snap,'2026-10-30T05:00:00.000Z')
    .canCheckout).toBe(false);
 });
 it('rejects tampered totals, source metadata, altered expiry, and a payable kind',()=>{
  const snap=create();
  expect(fail(()=>verifyInternalQuoteSnapshot({...snap,requestId:uuid('9')},createdAt)))
    .toBe('SNAPSHOT_TAMPERED');
  expect(fail(()=>verifyInternalQuoteSnapshot({...snap,sourceDigest:'b'.repeat(64)},createdAt)))
    .toBe('SNAPSHOT_TAMPERED');
  expect(fail(()=>verifyInternalQuoteSnapshot({...snap,expiresAt:'2026-10-31T05:00:00.000Z'},createdAt)))
    .toBe('SNAPSHOT_EXPIRY_TAMPERED');
  expect(fail(()=>verifyInternalQuoteSnapshot({...snap,researchQuote:{
    ...snap.researchQuote,totalPeriodMinor:0,
  }},createdAt))).toBe('QUOTE_MISMATCH');
  expect(fail(()=>makeInternalQuoteSnapshot({snapshotId:uuid('5'),createdAt,source:{
    ...source,simulation:{...source.simulation,canCheckout:true as false},
  }}))).toBe('SIMULATION_MISMATCH');
  expect(fail(()=>makeInternalQuoteSnapshot({snapshotId:uuid('5'),createdAt,source:{
    ...source,candidateId:'bad',
  }}))).toBe('SOURCE_INVALID');
 });
});
describe('operator API protects snapshots from customer financial flows',()=>{
 it('requires operator for every method and restricts input to exactly two saved IDs',()=>{
  const route=read('src/app/api/admin/platform/internal-quote-snapshots/route.ts');
  expect(route.match(/requirePlatformOperator\(\)/g)).toHaveLength(2);
  expect(route).toContain("Object.keys(b).length!==2");
  expect(route).toContain("['requestId','candidateId']");
  expect(route).toContain("'Cache-Control':'no-store'");
  expect(route).toContain('actorUserId:auth.userId');
  expect(route).not.toContain('req.body.amount');
  expect(route).not.toContain("export async function PATCH");
  expect(route).not.toContain("export async function DELETE");
 });
 it('serializes tenant snapshot storage and rejects stale or unreviewed source',()=>{
  const svc=read('src/platform/commercial/internalQuoteSnapshotService.ts');
  expect(svc).toContain('assertNotBootstrapTenant(tx,tenantId');
  expect(svc).toContain('acquireTenantApplock(tx,tenantId,TENANT_COMMERCIAL_LOCK_PARTS)');
  expect(svc).toContain('WITH (UPDLOCK,HOLDLOCK)');
  expect(svc).toContain("if(inquiry.status!=='awaiting_pricing')");
  expect(svc).toContain('prepareCatalogReleaseCandidate(researchSource)');
  expect(svc).toContain('candidate.sourceDigest!==String(src.SourceDigest)');
  expect(svc).toContain('INSERT INTO dbo.ModularInternalQuoteSnapshot');
  expect(svc).not.toContain('INSERT INTO dbo.TenantSubscription');
  expect(svc).not.toContain('UPDATE dbo.TenantAppEntitlement');
  expect(svc).not.toContain('createPaymentIntent');
  expect(svc).not.toContain('publishPlatformOutboxEvent');
 });
 it('operator archive clearly separates research snapshots from customer sales',()=>{
  const page=read('src/app/platform/internal-quote-snapshots/page.tsx');
  const ui=read('src/components/platform/InternalQuoteSnapshotsClient.tsx');
  const layout=read('src/app/platform/layout.tsx');
  expect(page).toContain('requirePlatformOperator()');
  expect(layout).toContain('/platform/internal-quote-snapshots');
  expect(ui).toContain('/api/admin/platform/internal-quote-snapshots');
  expect(ui).toContain('ليست فاتورة ولا Quote للعميل');
  expect(ui).not.toContain('إتمام الدفع');
  expect(ui).not.toContain('/api/tenant/billing');
 });
});
