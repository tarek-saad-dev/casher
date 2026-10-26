import 'server-only';
import {randomUUID} from 'node:crypto';
import {getPool,sql} from '@/lib/db';
import {getCommercialReleaseCandidate} from './commercialReleaseService';
import {COMMERCIAL_RELEASE_BLOCKERS,type CommercialBlocker} from './commercialReleasePolicy';
import {
  PolicyEvidenceError,validatePolicyEvidenceInput,validatePolicyReview,
  summarizePolicyEvidence,type PolicyReviewAction,
} from './commercialPolicyEvidencePolicy';

export type CommercialPolicyEvidenceRow={
  evidenceId:string;candidateId:string;blockerCode:CommercialBlocker;revision:number;
  evidenceText:string;status:'submitted'|'reviewed_internal'|'changes_requested';
  submittedByUserId:number;submittedAt:string;
  reviewedByUserId:number|null;reviewedAt:string|null;reviewNote:string|null;
  canPublish:false;canCheckout:false;
};
const COLS='EvidenceId,CandidateId,BlockerCode,Revision,EvidenceText,Status,SubmittedByUserId,SubmittedAt,ReviewedByUserId,ReviewedAt,ReviewNote';
function shape(r:Record<string,unknown>):CommercialPolicyEvidenceRow {
 return {
   evidenceId:String(r.EvidenceId),candidateId:String(r.CandidateId),
   blockerCode:String(r.BlockerCode) as CommercialBlocker,revision:Number(r.Revision),
   evidenceText:String(r.EvidenceText),
   status:String(r.Status) as CommercialPolicyEvidenceRow['status'],
   submittedByUserId:Number(r.SubmittedByUserId),
   submittedAt:new Date(r.SubmittedAt as Date|string).toISOString(),
   reviewedByUserId:r.ReviewedByUserId==null?null:Number(r.ReviewedByUserId),
   reviewedAt:r.ReviewedAt?new Date(r.ReviewedAt as Date|string).toISOString():null,
   reviewNote:r.ReviewNote==null?null:String(r.ReviewNote),
   canPublish:false,canCheckout:false,
 };
}
const RESPONSE={mode:'internal_policy_evidence' as const,canPublish:false as const,
  canIssueCustomerQuote:false as const,canCheckout:false as const};
export async function listCommercialPolicyEvidence(candidateId:string){
 const candidate=await getCommercialReleaseCandidate(candidateId);
 const pool=await getPool();
 const r=await pool.request().input('id',sql.UniqueIdentifier,candidateId)
  .query(`SELECT TOP 250 ${COLS} FROM dbo.ModularCommercialPolicyEvidence
    WHERE CandidateId=@id ORDER BY SubmittedAt DESC,EvidenceId DESC;`);
 const rows=(r.recordset as Record<string,unknown>[]).map(shape);
 return {...RESPONSE,candidateId,sourceDigest:candidate.sourceDigest,
   rows,summary:summarizePolicyEvidence(COMMERCIAL_RELEASE_BLOCKERS,rows)};
}
function assertActor(actor:number):void {
 if(!Number.isSafeInteger(actor)||actor<=0)
  throw new PolicyEvidenceError('ACTOR_REQUIRED','حساب المشغّل غير صالح',403);
}
/**
 * Append-only versions per candidate+blocker; no direct edits of existing content.
 * Concurrent operator submissions serialize under SQL transaction applock.
 */
export async function submitCommercialPolicyEvidence(args:{
 candidateId:string;blockerCode:string;evidenceText:string;actorUserId:number;
}):Promise<CommercialPolicyEvidenceRow>{
 assertActor(args.actorUserId);
 const input=validatePolicyEvidenceInput(args.blockerCode,args.evidenceText);
 const verified=await getCommercialReleaseCandidate(args.candidateId);
 const pool=await getPool(),tx=new sql.Transaction(pool);await tx.begin();
 try{
  const lock=await new sql.Request(tx)
   .input('resource',sql.NVarChar(255),'drvo:commercial-evidence:'+args.candidateId+':'+input.blockerCode)
   .query(`DECLARE @ret INT;
      EXEC @ret=sp_getapplock @Resource=@resource,@LockMode='Exclusive',
        @LockOwner='Transaction',@LockTimeout=10000;
      SELECT @ret AS acquired;`);
  if(Number(lock.recordset[0]?.acquired)<0)
   throw new PolicyEvidenceError('BUSY','مراجعة أخرى جارية لهذا الشرط',409);
  const parent=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.candidateId)
   .query(`SELECT SourceDigest,Status FROM dbo.ModularCommercialReleaseCandidate WITH (UPDLOCK,HOLDLOCK)
      WHERE CandidateId=@id;`);
  if(parent.recordset[0]?.Status!=='pending_policy'||
      String(parent.recordset[0]?.SourceDigest)!==verified.sourceDigest)
   throw new PolicyEvidenceError('SOURCE_CHANGED','ملف الإصدار اتغير. راجع المصدر',409);
  const previous=await new sql.Request(tx)
   .input('id',sql.UniqueIdentifier,args.candidateId)
   .input('code',sql.NVarChar(64),input.blockerCode)
   .query(`SELECT TOP 1 Revision,Status,EvidenceText FROM dbo.ModularCommercialPolicyEvidence WITH (UPDLOCK,HOLDLOCK)
       WHERE CandidateId=@id AND BlockerCode=@code ORDER BY Revision DESC;`);
  const last=previous.recordset[0] as {Revision:number;Status:string;EvidenceText:string}|undefined;
  if(last?.Status==='submitted')
   throw new PolicyEvidenceError('PENDING_REVIEW','لازم الإصدار السابق يتراجع الأول',409);
  const rev=last?Number(last.Revision)+1:1;
  if(!Number.isSafeInteger(rev)||rev>2147483647)
   throw new PolicyEvidenceError('REVISION_EXHAUSTED','عدد الإصدارات تجاوز الحد',409);
  const id=randomUUID();
  const saved=await new sql.Request(tx).input('evidenceId',sql.UniqueIdentifier,id)
   .input('candidateId',sql.UniqueIdentifier,args.candidateId)
   .input('code',sql.NVarChar(64),input.blockerCode)
   .input('revision',sql.Int,rev)
   .input('evidenceText',sql.NVarChar(1000),input.evidenceText)
   .input('actor',sql.Int,args.actorUserId)
   .query(`INSERT INTO dbo.ModularCommercialPolicyEvidence
     (EvidenceId,CandidateId,BlockerCode,Revision,EvidenceText,Status,SubmittedByUserId)
     VALUES (@evidenceId,@candidateId,@code,@revision,@evidenceText,N'submitted',@actor);
     SELECT ${COLS} FROM dbo.ModularCommercialPolicyEvidence
     WHERE EvidenceId=@evidenceId AND CandidateId=@candidateId;`);
  const result=shape(saved.recordset[0] as Record<string,unknown>);
  await tx.commit();return result;
 }catch(err){try{await tx.rollback();}catch{/* original error */}throw err;}
}
export async function reviewCommercialPolicyEvidence(args:{
 evidenceId:string;actorUserId:number;action:PolicyReviewAction;note:string;
}):Promise<CommercialPolicyEvidenceRow>{
 assertActor(args.actorUserId);
 const pool=await getPool();
 // Resolve the source without row locks, then check a verified digest before mutating.
 const lookup=await pool.request().input('id',sql.UniqueIdentifier,args.evidenceId)
   .query('SELECT CandidateId FROM dbo.ModularCommercialPolicyEvidence WHERE EvidenceId=@id;');
 const candidateId=lookup.recordset[0]?.CandidateId
   ?String(lookup.recordset[0].CandidateId):null;
 if(!candidateId)throw new PolicyEvidenceError('NOT_FOUND','المستند غير موجود',404);
 const verified=await getCommercialReleaseCandidate(candidateId);
 const tx=new sql.Transaction(pool);await tx.begin();
 try{
  // Always acquire candidate lock before evidence lock, matching append-only writers.
  const parent=await new sql.Request(tx).input('id',sql.UniqueIdentifier,candidateId)
   .query(`SELECT SourceDigest,Status FROM dbo.ModularCommercialReleaseCandidate WITH (UPDLOCK,HOLDLOCK)
     WHERE CandidateId=@id;`);
  if(parent.recordset[0]?.Status!=='pending_policy'||
     String(parent.recordset[0]?.SourceDigest)!==verified.sourceDigest)
   throw new PolicyEvidenceError('SOURCE_CHANGED','ملف الإصدار اتغير أثناء المراجعة',409);
  const found=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.evidenceId)
   .input('candidateId',sql.UniqueIdentifier,candidateId)
   .query(`SELECT ${COLS} FROM dbo.ModularCommercialPolicyEvidence WITH (UPDLOCK,HOLDLOCK)
      WHERE EvidenceId=@id AND CandidateId=@candidateId;`);
  const row=found.recordset[0] as Record<string,unknown>|undefined;
  if(!row)throw new PolicyEvidenceError('NOT_FOUND','المستند غير موجود',404);
  const current=shape(row);
  if(current.submittedByUserId===args.actorUserId)
   throw new PolicyEvidenceError('INDEPENDENT_REVIEW_REQUIRED','مش مسموح تراجع دليلك بنفسك',403);
  // An earlier review is idempotent only when the same reviewer and exact content replay.
  if(current.status!=='submitted'){
   if(current.status===args.action&&current.reviewedByUserId===args.actorUserId&&
      current.reviewNote===args.note.trim()){
     await tx.commit();return current;
   }
   throw new PolicyEvidenceError('ALREADY_REVIEWED','الدليل اتراجع قبل كده',409);
  }
  const note=validatePolicyReview({status:current.status,
   submittedByUserId:current.submittedByUserId,reviewedByUserId:args.actorUserId,
   action:args.action,note:args.note});
  const result=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.evidenceId)
   .input('actor',sql.Int,args.actorUserId)
   .input('status',sql.NVarChar(24),args.action)
   .input('note',sql.NVarChar(500),note)
   .query(`UPDATE dbo.ModularCommercialPolicyEvidence
     SET Status=@status,ReviewedByUserId=@actor,ReviewedAt=SYSUTCDATETIME(),ReviewNote=@note
     WHERE EvidenceId=@id AND Status=N'submitted' AND SubmittedByUserId<>@actor;
     SELECT @@ROWCOUNT AS changed;`);
  if(Number(result.recordset[0]?.changed)!==1)
   throw new PolicyEvidenceError('REVIEW_CONFLICT','الطلب اتغير أثناء الحفظ',409);
  const final=await new sql.Request(tx).input('id',sql.UniqueIdentifier,args.evidenceId)
    .query(`SELECT ${COLS} FROM dbo.ModularCommercialPolicyEvidence WHERE EvidenceId=@id;`);
  const saved=shape(final.recordset[0] as Record<string,unknown>);
  await tx.commit();return saved;
 }catch(err){try{await tx.rollback();}catch{/* original error */}throw err;}
}
