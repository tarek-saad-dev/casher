import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {COMMERCIAL_RELEASE_BLOCKERS} from '@/platform/commercial/commercialReleasePolicy';
import {
  PolicyEvidenceError,validatePolicyEvidenceInput,validatePolicyReview,
  summarizePolicyEvidence,
} from '@/platform/commercial/commercialPolicyEvidencePolicy';
import {DRVO_MIGRATIONS} from '../../../scripts/drvo/migrations/index';
import {checksumFile} from '../../../scripts/drvo/checksum';
import {readSqlBatches} from '../../../scripts/drvo/sqlBatch';

const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');
const schema='db/drvo-migrations/021-commercial-policy-evidence/schema.sql';
const sql=read(schema).replace(/\/\*[\s\S]*?\*\//g,'').replace(/--.*$/gm,'');
const fails=(fn:()=>unknown)=>{
 try{fn();return 'NO_ERROR';}catch(e){return e instanceof PolicyEvidenceError?e.code:'OTHER_ERROR';}
};
const blocker=COMMERCIAL_RELEASE_BLOCKERS[0]!;
describe('DRVO-021 reviewed policy evidence migration',()=>{
 it('registers 021, checksum, additive dependency and a single SQL batch',()=>{
  const migration=DRVO_MIGRATIONS.find(x=>x.migrationKey==='commercial-policy-evidence');
  expect(migration).toMatchObject({migrationId:21,dependencies:['commercial-release-candidates']});
  expect(migration?.checksum).toBe(checksumFile(path.join(process.cwd(),schema)));
  expect(migration?.control).toMatchObject({kind:'schema',risk:'LOW',lockProfile:'short'});
  expect(readSqlBatches(path.join(process.cwd(),schema))).toHaveLength(1);
  expect(sql).toContain('SET XACT_ABORT ON');
  expect(sql).toContain('BEGIN TRAN');
  expect(sql).toContain('ROLLBACK TRAN');
 });
 it('constrains all ten blockers, version uniqueness, reviewer and only internal review statuses',()=>{
  expect(sql).toContain('UNIQUE(CandidateId,BlockerCode,Revision)');
  expect(sql).toContain('FOREIGN KEY(CandidateId)');
  expect(sql).toContain('SubmittedByUserId<>ReviewedByUserId');
  expect(sql).toContain("N'reviewed_internal'");
  expect(sql).toContain("N'changes_requested'");
  expect(sql).toContain('CK_ModularCommercialPolicyEvidence_EvidenceText');
  for(const blocker of COMMERCIAL_RELEASE_BLOCKERS)
   expect(sql).toContain("N'"+blocker+"'");
  expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|MERGE)\b/i);
  for(const forbidden of ['dbo.ModularPriceCatalog','dbo.TenantSubscription','dbo.TenantAppEntitlement','dbo.Invoice'])
   expect(sql).not.toContain(forbidden);
  expect(sql).not.toContain("N'approved'");
 });
});
describe('two-person internal commercial evidence policy',()=>{
 it('validates exact code, bounded text and strips whitespace',()=>{
  expect(validatePolicyEvidenceInput(blocker,'  decision reference  ')).toEqual({
   blockerCode:blocker,evidenceText:'decision reference',
  });
  expect(fails(()=>validatePolicyEvidenceInput('UNKNOWN_BLOCKER','ok'))).toBe('UNKNOWN_BLOCKER');
  expect(fails(()=>validatePolicyEvidenceInput(blocker,'  '))).toBe('INVALID_EVIDENCE');
  expect(fails(()=>validatePolicyEvidenceInput(blocker,'a'.repeat(1001)))).toBe('INVALID_EVIDENCE');
 });
 it('prevents self-review, invalid outcomes, absent notes and duplicate reviews',()=>{
  const v={status:'submitted' as const,submittedByUserId:5,reviewedByUserId:6,
   action:'reviewed_internal' as const,note:'  evidence checked  '};
  expect(validatePolicyReview(v)).toBe('evidence checked');
  expect(fails(()=>validatePolicyReview({...v,reviewedByUserId:5}))).toBe('INDEPENDENT_REVIEW_REQUIRED');
  expect(fails(()=>validatePolicyReview({...v,note:' '}))).toBe('NOTE_REQUIRED');
  expect(fails(()=>validatePolicyReview({...v,action:'approved' as 'reviewed_internal'}))).toBe('INVALID_ACTION');
  expect(fails(()=>validatePolicyReview({...v,status:'reviewed_internal'}))).toBe('EVIDENCE_REVIEWED');
 });
 it('all internal reviews still cannot publish a catalog or quote',()=>{
  const reviewed=COMMERCIAL_RELEASE_BLOCKERS.map(blockerCode=>({
    blockerCode,revision:1,status:'reviewed_internal',
  }));
  const r=summarizePolicyEvidence(COMMERCIAL_RELEASE_BLOCKERS,reviewed);
  expect(r.reviewedInternalCount).toBe(10);
  expect(r.submittedCount).toBe(0);
  expect(r.canPublish).toBe(false);
  const again=summarizePolicyEvidence(COMMERCIAL_RELEASE_BLOCKERS,[
    ...reviewed,{blockerCode:blocker,revision:2,status:'changes_requested'},
  ]);
  expect(again.reviewedInternalCount).toBe(9);
  expect(again.latestByBlocker[blocker]).toMatchObject({revision:2,status:'changes_requested'});
  expect(again.canPublish).toBe(false);
 });
});
describe('operator-only immutable evidence API and UI',()=>{
 it('authenticates all methods and only accepts strict fields',()=>{
  const api=read('src/app/api/admin/platform/commercial-policy-evidence/route.ts');
  expect(api.match(/requirePlatformOperator\(\)/g)).toHaveLength(3);
  expect(api).toContain("Object.keys(b).length!==3");
  expect(api).toContain("['candidateId','blockerCode','evidenceText']");
  expect(api).toContain("['evidenceId','action','note']");
  expect(api).toContain("'Cache-Control':'no-store'");
  expect(api).toContain("actorUserId:auth.userId");
  expect(api).not.toContain('body.tenantId');
  expect(api).not.toContain('body.amount');
  expect(api).not.toContain('createPaymentIntent');
 });
 it('locks source prior to updates, appends immutable revisions and isolates reviewers',()=>{
  const svc=read('src/platform/commercial/commercialPolicyEvidenceService.ts');
  expect(svc).toContain('await getCommercialReleaseCandidate(args.candidateId)');
  expect(svc).toContain('await getCommercialReleaseCandidate(candidateId)');
  expect(svc).toContain('WITH (UPDLOCK,HOLDLOCK)');
  expect(svc).toContain('sp_getapplock');
  expect(svc).toContain('if(last?.Status===\'submitted\')');
  expect(svc).toContain('INSERT INTO dbo.ModularCommercialPolicyEvidence');
  expect(svc).toContain("WHERE EvidenceId=@id AND Status=N'submitted' AND SubmittedByUserId<>@actor");
  expect(svc).toContain('ROW_NUMBER() OVER (PARTITION BY BlockerCode ORDER BY Revision DESC)');
  expect(svc).not.toContain('UPDATE dbo.ModularPriceCatalog');
  expect(svc).not.toContain('UPDATE dbo.TenantSubscription');
  expect(svc).not.toContain('activateTenantSubscription');
 });
 it('separates operator evidence review from a customer payable checkout',()=>{
  const ui=read('src/components/platform/CommercialPolicyEvidenceClient.tsx');
  const page=read('src/app/platform/commercial-release/[candidateId]/page.tsx');
  const index=read('src/components/platform/CommercialReleaseCandidatesClient.tsx');
  expect(page).toContain('requirePlatformOperator()');
  expect(ui).toContain('مراجعة أدلة إطلاق الكتالوج');
  expect(ui).toContain('تمت المراجعة الداخلية');
  expect(ui).toContain('/api/admin/platform/commercial-policy-evidence');
  expect(index).toContain('فتح ملف الأدلة والمراجعات');
  expect(ui).not.toContain('تأكيد الدفع');
  expect(ui).not.toContain('إصدار فاتورة');
 });
});
