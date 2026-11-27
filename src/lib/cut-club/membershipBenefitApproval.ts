export type BenefitApprovalCommand={action:'APPROVE'|'REVOKE';programCode:string;programRevision:number;publicationRevision:number;benefitRevision:number;expectedRevision:number;reason:string};
export type BenefitApprovalRow={programCode:string;programRevision:number;publicationRevision:number;benefitRevision:number;revision:number;action:'APPROVE'|'REVOKE';status:'APPROVED_FOR_TEST'|'REVOKED'|'SUPERSEDED';createdAt:string};
const integer=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
export function parseBenefitApproval(v:unknown):BenefitApprovalCommand|null{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;
 const x=v as Record<string,unknown>;
 if(Object.keys(x).sort().join(',')!=='action,benefitRevision,expectedRevision,programCode,programRevision,publicationRevision,reason'||
 !['APPROVE','REVOKE'].includes(x.action as string)||typeof x.programCode!=='string'||!/^[A-Z0-9_-]{1,40}$/.test(x.programCode)||
 !integer(x.programRevision,1,2147483647)||!integer(x.publicationRevision,1,2147483647)||!integer(x.benefitRevision,1,2147483647)||!integer(x.expectedRevision,0,2147483646)||
 (x.action==='REVOKE'&&x.expectedRevision===0)||typeof x.reason!=='string'||x.reason.trim().length<5||x.reason.trim().length>300)return null;
 return {...x,reason:x.reason.trim()} as BenefitApprovalCommand;
}
