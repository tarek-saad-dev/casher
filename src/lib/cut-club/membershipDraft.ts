import {membershipKinds,type MembershipKind} from './membershipPolicy';
export const pilotTenant='413d433e-f36b-1410-8820-009ec495c7e1';
export type DraftInput={code:string;expectedRevision:number;title:string;kind:MembershipKind;minimumVisits:number;allowedBranchIds:number[];partnerCode:string|null;reason:string};
export type DraftRow=Omit<DraftInput,'expectedRevision'>&{revision:number;createdAt:string};
const key=/^[A-Z0-9_-]{1,40}$/;
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export function parseMembershipDraft(value:unknown):DraftInput|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const x=value as Record<string,unknown>;
 if(Object.keys(x).sort().join(',')!=='allowedBranchIds,code,expectedRevision,kind,minimumVisits,partnerCode,reason,title')return null;
 if(typeof x.code!=='string'||!key.test(x.code)||!int(x.expectedRevision,0,2147483646)||
  typeof x.title!=='string'||x.title.trim().length<1||x.title.trim().length>100||
  !membershipKinds.includes(x.kind as MembershipKind)||!int(x.minimumVisits,0,100000)||
  !Array.isArray(x.allowedBranchIds)||x.allowedBranchIds.length<1||x.allowedBranchIds.length>2||
  !x.allowedBranchIds.every(b=>b===1||b===3)||new Set(x.allowedBranchIds).size!==x.allowedBranchIds.length||
  (x.partnerCode!==null&&(typeof x.partnerCode!=='string'||!key.test(x.partnerCode)))||
  (x.kind==='GENERAL'&&x.partnerCode!==null)||typeof x.reason!=='string'||x.reason.trim().length<5||x.reason.trim().length>300)return null;
 return {...x,title:x.title.trim(),reason:x.reason.trim(),allowedBranchIds:[...x.allowedBranchIds].sort()} as DraftInput;
}
