import type {MembershipKind} from './membershipPolicy';
export const proofKinds=['STUDENT','DOCTOR','COMPANY'] as const;
export type ProofKind=Exclude<MembershipKind,'GENERAL'>;
type Common={accountId:string;kind:ProofKind;expectedRevision:number;reason:string};
export type ProofCommand=(Common&{action:'APPROVE';expectedClientId:number;partnerCode:string|null;expiresAt:string;reviewedInPerson:true})|(Common&{action:'REVOKE'});
export type ProofRow={kind:ProofKind;revision:number;status:'VERIFIED'|'EXPIRED'|'REVOKED'|'ACCOUNT_INELIGIBLE';partnerCode:string|null;expiresAt:string|null;reviewedAt:string};
export type ProofAccount={accountId:string;maskedPhone:string;clientId:number|null;eligibleAccount:boolean;proofs:ProofRow[]};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const int=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
const key=/^[A-Z0-9_-]{1,40}$/;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function parseProofCommand(v:unknown,now=new Date()):ProofCommand|null{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;
 const x=v as Record<string,unknown>;
 if(typeof x.accountId!=='string'||!uuid.test(x.accountId)||!proofKinds.includes(x.kind as ProofKind)||
 !int(x.expectedRevision,0,2147483646)||typeof x.reason!=='string'||x.reason.trim().length<5||x.reason.trim().length>300)return null;
 const keys=Object.keys(x).sort().join(',');
 if(x.action==='REVOKE'){
  if(keys!=='accountId,action,expectedRevision,kind,reason'||x.expectedRevision===0)return null;
 }else if(x.action==='APPROVE'){
  if(keys!=='accountId,action,expectedClientId,expectedRevision,expiresAt,kind,partnerCode,reason,reviewedInPerson'||
   !int(x.expectedClientId,1,2147483647)||x.reviewedInPerson!==true||
   (x.partnerCode!==null&&(typeof x.partnerCode!=='string'||!key.test(x.partnerCode)))||
   typeof x.expiresAt!=='string'||!iso.test(x.expiresAt)||!Number.isFinite(Date.parse(x.expiresAt))||
   new Date(x.expiresAt).toISOString()!==x.expiresAt||!(Date.parse(x.expiresAt)>now.getTime()))return null;
 }else return null;
 return {...x,accountId:x.accountId.toLowerCase(),reason:x.reason.trim()} as ProofCommand;
}
