import type {MembershipKind} from './membershipPolicy';
export type PublicationCommand={action:'PUBLISH'|'WITHDRAW';code:string;programRevision:number;expectedRevision:number;reason:string};
export type PublishedProgram={code:string;title:string;kind:MembershipKind;programRevision:number;publicationRevision:number;minimumVisits:number;allowedBranchIds:number[];requiresPartner:boolean};
export type PublicationAdminRow={code:string;title:string;kind:MembershipKind;programRevision:number;publicationRevision:number;publishedProgramRevision:number|null;status:'DRAFT'|'PUBLISHED'|'UPDATE_PENDING'|'WITHDRAWN'};
const int=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
export function parsePublicationCommand(v:unknown):PublicationCommand|null{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;
 const x=v as Record<string,unknown>;
 if(Object.keys(x).sort().join(',')!=='action,code,expectedRevision,programRevision,reason'||
 !['PUBLISH','WITHDRAW'].includes(x.action as string)||typeof x.code!=='string'||!/^[A-Z0-9_-]{1,40}$/.test(x.code)||
 !int(x.programRevision,1,2147483647)||!int(x.expectedRevision,0,2147483646)||
 (x.action==='WITHDRAW'&&x.expectedRevision===0)||typeof x.reason!=='string'||x.reason.trim().length<5||x.reason.trim().length>300)return null;
 return {...x,reason:x.reason.trim()} as PublicationCommand;
}
