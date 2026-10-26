import type {ConnectionPool} from 'mssql';
import {DRVO_MIGRATIONS,assertDrvoMigrationManifestValid} from '../../../scripts/drvo/migrations/index';
import {listAppliedDrvoMigrations} from '../../../scripts/drvo/registry';
import {isAcceptedChecksum} from '../../../scripts/drvo/checksum';
import {verifyTariffResearchSchema} from '../../../scripts/drvo/migrations/019-tariff-research-review';
import {verifyCommercialReleaseCandidates} from '../../../scripts/drvo/migrations/020-commercial-release-candidates';
import {verifyCommercialPolicyEvidence} from '../../../scripts/drvo/migrations/021-commercial-policy-evidence';
import {verifyInternalQuoteSnapshotSchema} from '../../../scripts/drvo/migrations/022-internal-quote-snapshots';
import {prepareCatalogReleaseCandidate,type ResearchSource} from './commercialReleasePolicy';
import {verifyInternalQuoteSnapshot,type InternalQuoteSnapshotPayload} from './internalQuoteSnapshotPolicy';

export const MODULAR_STAGING_DATABASE='last132_agent' as const;
export const MODULAR_STAGING_LOGIN='drvo_agent' as const;
export const MODULAR_STAGING_PORT=14330 as const;

/**
 * Protect from accidentally reading a production DB when using the staging command.
 * The SSH host itself is supplied exclusively by DRVO_STAGING_SSH_HOST.
 */
export function validateModularStagingTarget(input:{
  confirmed:string|undefined;database:string|undefined;user:string|undefined;
  server:string|undefined;port:string|undefined;
}):void {
  if(input.confirmed!=='1'||input.database!==MODULAR_STAGING_DATABASE||
    input.user!==MODULAR_STAGING_LOGIN||input.server!=='127.0.0.1'||
    input.port!==String(MODULAR_STAGING_PORT))
    throw new Error('STAGING_TARGET_REFUSED: explicit isolated SQL tunnel and staging identity required');
}
export type ModularStagingReport={
  mode:'read_only_staging_preflight';database:string;login:string;
  ok:boolean;checks:{id:string;ok:boolean;detail:string}[];
  candidateCount:number;snapshotCount:number;
  sampleCandidateCoverage:boolean;sampleSnapshotCoverage:boolean;
  mutationsPerformed:false;customerCheckoutTested:false;productionTouched:false;
};
const CHECK_MIGRATIONS=[15,16,17,18,19,20,21,22] as const;
type Check=(id:string,ok:boolean,detail:string)=>void;

export async function inspectModularCommercialStaging(pool:ConnectionPool, expectedServerName:string):Promise<ModularStagingReport>{
  if(!expectedServerName || expectedServerName.trim()!==expectedServerName || expectedServerName.length>256)
    throw new Error('STAGING_SERVER_PIN_MISSING: a separately verified SQL Server identity is required');
  const checks:ModularStagingReport['checks']=[];
  const record:Check=(id,ok,detail)=>checks.push({id,ok,detail});
  assertDrvoMigrationManifestValid();
  const proof=await pool.request().query(
    "SELECT DB_NAME() AS db, ORIGINAL_LOGIN() AS originalLogin, SUSER_SNAME() AS effectiveLogin, CONVERT(nvarchar(256), SERVERPROPERTY('ServerName')) AS serverName;");
  const identity=proof.recordset[0] as {db?:string;originalLogin?:string;effectiveLogin?:string;serverName?:string}|undefined;
  const database=String(identity?.db??'');
  const login=String(identity?.originalLogin??'');
  if(database!==MODULAR_STAGING_DATABASE||login.toLowerCase()!==MODULAR_STAGING_LOGIN||
     String(identity?.effectiveLogin??'').toLowerCase()!==MODULAR_STAGING_LOGIN||
     String(identity?.serverName??'')!==expectedServerName)
    throw new Error('STAGING_DB_IDENTITY_MISMATCH: refusing queries on unexpected database/login');
  record('staging.identity',true,'Verified pinned SQL Server identity, exact database, original and effective SQL login');

  const bootstrap=await pool.request().query(
    "SELECT COUNT_BIG(*) AS count FROM dbo.Tenant WHERE Code=N'CASHER_BOOT';");
  const bootstrapCount=Number(bootstrap.recordset[0]?.count??0);
  record('bootstrap.tenant',bootstrapCount===1,
    bootstrapCount===1?'Bootstrap tenant exists, read-only verified':
      'Missing/duplicated bootstrap tenant; stop release');

  const applied=await listAppliedDrvoMigrations(pool);
  for(const id of CHECK_MIGRATIONS){
    const def=DRVO_MIGRATIONS.find(m=>m.migrationId===id);
    const row=applied.find(r=>r.MigrationId===id);
    const ok=Boolean(def&&row&&row.MigrationKey===def.migrationKey&&
      isAcceptedChecksum(def,row.Checksum));
    record('migration.'+id,ok,
      ok?'Applied with expected registry key and checksum':
      'Missing or checksum mismatch; do not treat Staging as ready');
  }
  const verify=[
    {id:19,fn:verifyTariffResearchSchema},
    {id:20,fn:verifyCommercialReleaseCandidates},
    {id:21,fn:verifyCommercialPolicyEvidence},
    {id:22,fn:verifyInternalQuoteSnapshotSchema},
  ];
  let structureReady=true;
  for(const {id,fn} of verify){
    const v=await fn(pool);
    structureReady=structureReady&&v.ok;
    record('schema.'+id,v.ok,v.ok?'Columns, indexes and trusted constraints verified':v.failures.join('; '));
  }

  let candidateCount=0,snapshotCount=0;
  // Never trust a content checksum without recomputing from persisted research.
  // Only read application records after proving all relevant tables exist.
  if(structureReady){
    const candidates=await pool.request().query(`
      SELECT c.CandidateId,c.SourceVersion,c.IndustryCode AS CandidateIndustry,c.SourceDigest,
        c.Status AS CandidateStatus,p.ProposalId,p.IndustryCode,p.Version,p.PricingModel,
        p.CurrencyCode,p.AppPricesJson,p.BaseMonthlyMinor,p.ExtraBranchMonthlyMinor,
        p.IncludedBranches,p.AnnualMonthsCharged,p.Status,p.CreatedByUserId,
        p.ReviewedByUserId,p.ReviewedAt
      FROM dbo.ModularCommercialReleaseCandidate c
      INNER JOIN dbo.ModularTariffResearchProposal p ON p.ProposalId=c.SourceProposalId;`);
    candidateCount=candidates.recordset.length;
    let intact=true;
    for(const row of candidates.recordset as Record<string,unknown>[]){
      try{
        const source:ResearchSource={
          proposalId:String(row.ProposalId),industryCode:String(row.IndustryCode),
          version:Number(row.Version),pricingModel:String(row.PricingModel),
          currencyCode:String(row.CurrencyCode),appPricesJson:String(row.AppPricesJson),
          baseMonthlyMinor:String(row.BaseMonthlyMinor),
          extraBranchMonthlyMinor:String(row.ExtraBranchMonthlyMinor),
          includedBranches:Number(row.IncludedBranches),
          annualMonthsCharged:Number(row.AnnualMonthsCharged),
          status:String(row.Status),createdByUserId:Number(row.CreatedByUserId),
          reviewedByUserId:row.ReviewedByUserId==null?null:Number(row.ReviewedByUserId),
          reviewedAt:row.ReviewedAt as Date|string|null,
        };
        const expected=prepareCatalogReleaseCandidate(source);
        if(row.CandidateStatus!=='pending_policy'||
          expected.sourceDigest!==String(row.SourceDigest)||
          expected.sourceVersion!==Number(row.SourceVersion)||
          expected.industry!==String(row.CandidateIndustry))throw Error('candidate state/digest mismatch');
      }catch{intact=false;break;}
    }
    record('data.candidate-integrity',intact,
      'Checked '+candidateCount+' persisted release dossiers; zero dossiers means only schema verified');

    const snapshots=await pool.request().query(`
      SELECT SnapshotId,TenantId,RequestId,CandidateId,ResearchVersion,DraftRevision,
        SourceDigest,QuoteDigest,ResearchQuoteJson,Status,CreatedAt,ExpiresAt
      FROM dbo.ModularInternalQuoteSnapshot;`);
    snapshotCount=snapshots.recordset.length;
    let valid=true;
    const current=new Date().toISOString();
    const candidateIds=new Set((candidates.recordset as Array<{CandidateId:string}>)
      .map(x=>String(x.CandidateId).toLowerCase()));
    for(const row of snapshots.recordset as Record<string,unknown>[]){
      try{
        const candidateId=String(row.CandidateId).toLowerCase();
        if(!candidateIds.has(candidateId))throw Error('candidate not found');
        const payload:InternalQuoteSnapshotPayload={
          snapshotId:String(row.SnapshotId).toLowerCase(),
          tenantId:String(row.TenantId).toLowerCase(),
          requestId:String(row.RequestId).toLowerCase(),candidateId,
          researchVersion:Number(row.ResearchVersion),
          draftRevision:Number(row.DraftRevision),
          sourceDigest:String(row.SourceDigest),
          quoteDigest:String(row.QuoteDigest),
          researchQuote:JSON.parse(String(row.ResearchQuoteJson)) as InternalQuoteSnapshotPayload['researchQuote'],
          createdAt:new Date(row.CreatedAt as Date|string).toISOString(),
          expiresAt:new Date(row.ExpiresAt as Date|string).toISOString(),
          status:String(row.Status) as 'internal_only',availability:'internal_current',
          canIssueCustomerQuote:false,canAcceptOrder:false,canCheckout:false,
          canActivate:false,paid:false,orderCreated:false,
        };
        verifyInternalQuoteSnapshot(payload,current);
        const match=(candidates.recordset as Array<{CandidateId:string;SourceDigest:string;SourceVersion:number}>)
          .find(x=>String(x.CandidateId).toLowerCase()===candidateId);
        if(!match||match.SourceDigest!==payload.sourceDigest||
          Number(match.SourceVersion)!==payload.researchVersion)
          throw Error('snapshot has stale source version');
      }catch{valid=false;break;}
    }
    record('data.snapshot-integrity',valid,
      'Checked '+snapshotCount+' persisted research snapshots and candidate associations; zero snapshots means no real snapshot E2E');
  }else{
    record('data.candidate-integrity',false,'Skipped: migration schemas not ready');
    record('data.snapshot-integrity',false,'Skipped: migration schemas not ready');
  }
  return {mode:'read_only_staging_preflight',database,login,
    ok:checks.every(x=>x.ok),checks,candidateCount,snapshotCount,
    sampleCandidateCoverage:candidateCount>0,sampleSnapshotCoverage:snapshotCount>0,
    mutationsPerformed:false,customerCheckoutTested:false,productionTouched:false};
}
