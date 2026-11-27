import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {parseProofCommand,type ProofAccount,type ProofRow,type ProofKind} from './membershipProof';
export class ProofError extends Error{constructor(public code:string,public status:number){super(code);}}
type Scope={tenantId:string;staffId:number};
async function requireStage(request:sql.Request,scope:Scope){
 if(scope.tenantId.toLowerCase()!==pilotTenant||!Number.isSafeInteger(scope.staffId)||scope.staffId<=0||process.env.CUT_CLUB_STAGING_MEMBERSHIP_PROOF_ENABLED!=='true')throw new ProofError('PROOF_NOT_RELEASED',403);
 const r=await request.input('tenant',sql.UniqueIdentifier,scope.tenantId).query<{Ready:number}>(`
 SELECT CASE WHEN DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent'
 AND OBJECT_ID(N'dbo.CutClubMembershipProofEvent',N'U') IS NOT NULL
 AND COL_LENGTH(N'dbo.CutClubMemberAccount',N'AccessStatus') IS NOT NULL
 AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active')
 THEN 1 ELSE 0 END AS Ready`);
 if(r.recordset.length!==1||r.recordset[0].Ready!==1)throw new ProofError('PROOF_SCHEMA_UNAVAILABLE',503);
}
type Account={AccountID:string;PhoneNormalized:string;LegacyClientID:number|null;Eligible:number};
const accountFields=`SELECT TOP(2) a.AccountID,a.PhoneNormalized,a.LegacyClientID,
 CASE WHEN a.LinkStatus='ACTIVE' AND a.AccessStatus='ENABLED' AND EXISTS(
 SELECT 1 FROM dbo.TblClient c WITH(HOLDLOCK)
 CROSS APPLY(SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(c.Mobile)),' ',''),'-',''),'+',''),'(',''),')','') AS MobileClean) cleaned
 WHERE c.TenantId=a.TenantId AND c.ClientID=a.LegacyClientID AND a.PhoneNormalized=CASE
 WHEN LEN(cleaned.MobileClean)=11 AND cleaned.MobileClean LIKE '01[0125]%' THEN '2'+cleaned.MobileClean
 WHEN LEN(cleaned.MobileClean)=14 AND cleaned.MobileClean LIKE '00201[0125]%' THEN SUBSTRING(cleaned.MobileClean,3,12)
 ELSE cleaned.MobileClean END) THEN 1 ELSE 0 END AS Eligible
 FROM dbo.CutClubMemberAccount a WITH(UPDLOCK,HOLDLOCK) WHERE a.TenantId=@tenant`;
type Event={Kind:ProofKind;Revision:number;Action:'APPROVE'|'REVOKE';LegacyClientID:number;PartnerCode:string|null;ExpiresAtUtc:Date|null;CreatedAtUtc:Date;Expired:number};
export async function lookupMembershipProof(pool:sql.ConnectionPool,scope:Scope,phone:string):Promise<ProofAccount|null>{
 if(!/^201[0125]\d{8}$/.test(phone))throw new ProofError('INVALID_PHONE',400);
 await requireStage(pool.request(),scope);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 await requireStage(new sql.Request(tx),scope);
 const found=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,scope.tenantId).input('phone',sql.NVarChar(20),phone).query<Account>(accountFields+' AND a.PhoneNormalized=@phone');
 if(found.recordset.length!==1){await tx.rollback();return null;}
 const a=found.recordset[0];
 const rows=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,scope.tenantId).input('account',sql.UniqueIdentifier,a.AccountID).query<Event>(`
 WITH latest AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY Kind ORDER BY Revision DESC) AS rn FROM dbo.CutClubMembershipProofEvent
 WHERE TenantId=@tenant AND AccountID=@account)
 SELECT Kind,Revision,Action,LegacyClientID,PartnerCode,ExpiresAtUtc,CreatedAtUtc,
 CASE WHEN ExpiresAtUtc<=SYSUTCDATETIME() THEN 1 ELSE 0 END AS Expired FROM latest WHERE rn=1 ORDER BY Kind`);
 const eligible=a.Eligible===1;
 const proofs:ProofRow[]=rows.recordset.map(r=>({kind:r.Kind,revision:r.Revision,
 status:r.Action==='REVOKE'?'REVOKED':!eligible||r.LegacyClientID!==a.LegacyClientID?'ACCOUNT_INELIGIBLE':r.Expired===1?'EXPIRED':'VERIFIED',
 partnerCode:r.PartnerCode,expiresAt:r.ExpiresAtUtc?.toISOString()??null,reviewedAt:r.CreatedAtUtc.toISOString()}));
 const response={accountId:a.AccountID.toLowerCase(),maskedPhone:phone.slice(0,4)+'****'+phone.slice(-3),clientId:eligible?a.LegacyClientID:null,eligibleAccount:eligible,proofs};
 await tx.commit();return response;
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
export async function recordMembershipProof(pool:sql.ConnectionPool,scope:Scope,raw:unknown){
 const input=parseProofCommand(raw);if(!input)throw new ProofError('INVALID_PROOF',400);
 await requireStage(pool.request(),scope);
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 await requireStage(new sql.Request(tx),scope);
 const aResult=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,scope.tenantId).input('account',sql.UniqueIdentifier,input.accountId).query<Account>(accountFields+' AND a.AccountID=@account');
 if(aResult.recordset.length!==1)throw new ProofError('ACCOUNT_NOT_FOUND',404);
 const a=aResult.recordset[0];
 const current=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,scope.tenantId).input('account',sql.UniqueIdentifier,input.accountId).input('kind',sql.VarChar(16),input.kind).query<Event>(`
 SELECT TOP(1) Revision,Action,LegacyClientID FROM dbo.CutClubMembershipProofEvent WITH(UPDLOCK,HOLDLOCK)
 WHERE TenantId=@tenant AND AccountID=@account AND Kind=@kind ORDER BY Revision DESC`);
 const prev=current.recordset[0];
 if((prev?.Revision??0)!==input.expectedRevision)throw new ProofError('REVISION_CONFLICT',409);
 if(input.action==='APPROVE'&&(a.Eligible!==1||a.LegacyClientID!==input.expectedClientId))throw new ProofError('ACCOUNT_INELIGIBLE',409);
 if(input.action==='REVOKE'&&(!prev||prev.Action!=='APPROVE'))throw new ProofError('NO_PROOF_TO_REVOKE',409);
 const client=input.action==='APPROVE'?input.expectedClientId:prev.LegacyClientID;
 const expiry=input.action==='APPROVE'?new Date(input.expiresAt):null;
 const written=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,scope.tenantId).input('account',sql.UniqueIdentifier,input.accountId)
 .input('kind',sql.VarChar(16),input.kind).input('revision',sql.Int,input.expectedRevision+1).input('action',sql.VarChar(16),input.action)
 .input('client',sql.Int,client).input('partner',sql.VarChar(40),input.action==='APPROVE'?input.partnerCode:null)
 .input('expiry',sql.DateTime2,expiry).input('staff',sql.Int,scope.staffId).input('reason',sql.NVarChar(300),input.reason)
 .query<{Revision:number}>(`
 INSERT dbo.CutClubMembershipProofEvent(TenantId,AccountID,Kind,Revision,Action,LegacyClientID,PartnerCode,ExpiresAtUtc,StaffID,Reason)
 OUTPUT INSERTED.Revision SELECT @tenant,@account,@kind,@revision,@action,@client,@partner,@expiry,@staff,@reason
 WHERE @action='REVOKE' OR @expiry>SYSUTCDATETIME()`);
 if(written.recordset.length!==1)throw new ProofError('PROOF_EXPIRED',409);
 await tx.commit();return {revision:written.recordset[0].Revision};
 }catch(e){await tx.rollback().catch(()=>{});throw e;}
}
