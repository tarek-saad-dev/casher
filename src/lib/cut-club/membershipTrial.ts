import type {EligibilityReason} from './membershipPolicy';
export type TrialInput={action:'CHECK'|'ISSUE';accountId:string;programCode:string;programRevision:number;branchId:1|3;expectedTrialRevision:number;expiresAt:string;reason:string};
export type TrialResult={eligible:boolean;reasons:EligibilityReason[];visits:number|null;proofRevision:number|null;trialRevision:number;status:'NONE'|'CURRENT'|'EXPIRED'|'INVALIDATED';issued:boolean};
const int=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
export function parseTrialInput(v:unknown,now=new Date()):TrialInput|null{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;
 const x=v as Record<string,unknown>;
 if(Object.keys(x).sort().join(',')!=='accountId,action,branchId,expectedTrialRevision,expiresAt,programCode,programRevision,reason'||
 !['CHECK','ISSUE'].includes(x.action as string)||typeof x.accountId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x.accountId)||
 typeof x.programCode!=='string'||!/^[A-Z0-9_-]{1,40}$/.test(x.programCode)||!int(x.programRevision,1,2147483647)||!int(x.expectedTrialRevision,0,2147483646)||
 (x.branchId!==1&&x.branchId!==3)||typeof x.reason!=='string'||x.reason.trim().length<5||x.reason.trim().length>300||
 typeof x.expiresAt!=='string'||!Number.isFinite(Date.parse(x.expiresAt))||new Date(x.expiresAt).toISOString()!==x.expiresAt||
 !(Date.parse(x.expiresAt)>now.getTime())||Date.parse(x.expiresAt)>now.getTime()+365*86400000)return null;
 return {...x,accountId:x.accountId.toLowerCase(),reason:x.reason.trim()} as TrialInput;
}
