export type ApplicationStatus='PENDING'|'ACCEPTED_FOR_REVIEW'|'REJECTED'|'PROGRAM_CHANGED';
export type ApplicationRow={id:string;code:string;title:string;publicationRevision:number;branchId:1|3;status:ApplicationStatus;createdAt:string};
export type ApplicationSubmission={code:string;publicationRevision:number;branchId:1|3};
export type ApplicationDecision={id:string;decision:'ACCEPTED_FOR_REVIEW'|'REJECTED';reason:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseApplication(v:unknown):ApplicationSubmission|null{
 if(!object(v)||Object.keys(v).sort().join(',')!=='branchId,code,publicationRevision'||typeof v.code!=='string'||!/^[A-Z0-9_-]{1,40}$/.test(v.code)||typeof v.publicationRevision!=='number'||!Number.isSafeInteger(v.publicationRevision)||v.publicationRevision<1||v.publicationRevision>2147483647||(v.branchId!==1&&v.branchId!==3))return null;
 return v as ApplicationSubmission;
}
export function parseApplicationDecision(v:unknown):ApplicationDecision|null{
 if(!object(v)||Object.keys(v).sort().join(',')!=='decision,id,reason'||typeof v.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)||!['ACCEPTED_FOR_REVIEW','REJECTED'].includes(v.decision as string)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.trim().length>300)return null;
 return {...v,reason:v.reason.trim()} as ApplicationDecision;
}
