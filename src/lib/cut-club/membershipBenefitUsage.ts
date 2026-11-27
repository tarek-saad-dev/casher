export type UsageInput={receiptId:string;accountId:string;programCode:string;trialRevision:number;approvalRevision:number;serviceId:number;branchId:1|3;units:number};
export type UsageReversal={receiptId:string;reason:string};
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const integer=(x:unknown,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=1&&x<=max;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function parseUsageInput(v:unknown):UsageInput|null{
 if(!record(v)||Object.keys(v).sort().join(',')!=='accountId,approvalRevision,branchId,programCode,receiptId,serviceId,trialRevision,units'||!uuid(v.receiptId)||!uuid(v.accountId)||typeof v.programCode!=='string'||!/^[A-Z0-9_-]{1,40}$/.test(v.programCode)||!integer(v.trialRevision,2147483647)||!integer(v.approvalRevision,2147483647)||!integer(v.serviceId,2147483647)||(v.branchId!==1&&v.branchId!==3)||!integer(v.units,100))return null;
 return {...v,receiptId:v.receiptId.toLowerCase(),accountId:v.accountId.toLowerCase()} as UsageInput;
}
export function parseUsageReversal(v:unknown):UsageReversal|null{
 if(!record(v)||Object.keys(v).sort().join(',')!=='reason,receiptId'||!uuid(v.receiptId)||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.trim().length>300)return null;
 return {receiptId:v.receiptId.toLowerCase(),reason:v.reason.trim()};
}
