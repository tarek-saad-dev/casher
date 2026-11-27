/** Pure payment plan, never a live payment authorization. Amounts are integer piastres. */
export type PaymentAllocationMinor={methodId:number;amountMinor:number};
export type MembershipPaymentPlan={mode:'NO_PAYMENT'|'DIRECT'|'SPLIT';grandTotalMinor:number;headerMethodId:number|null;allocations:PaymentAllocationMinor[];createPaymentRows:boolean;createCashMovement:boolean;redistributeClearing:boolean;previewOnly:true};
export type PaymentPlanFailure='INVALID_TOTAL'|'INVALID_METHODS'|'INVALID_ALLOCATION'|'DUPLICATE_METHOD'|'PAYMENT_MISMATCH'|'ZERO_PAYMENT_NOT_APPROVED';
const int=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fail=(code:PaymentPlanFailure)=>({ok:false as const,code});
const maxMoney=9999999999;
export function planMembershipPayment(input:{grandTotalMinor:number;allocations:readonly PaymentAllocationMinor[];activeMethodIds:readonly number[];clearingMethodId:number;allowZeroPaymentPreview:boolean}):{ok:true;plan:MembershipPaymentPlan}|{ok:false;code:PaymentPlanFailure}{
 const {grandTotalMinor:total,allocations,activeMethodIds,clearingMethodId}=input;
 if(!int(total,0,maxMoney))return fail('INVALID_TOTAL');
 if(!int(clearingMethodId,1,2147483647)||!activeMethodIds.every(id=>int(id,1,2147483647))||new Set(activeMethodIds).size!==activeMethodIds.length)return fail('INVALID_METHODS');
 if(allocations.length>20||!allocations.every(a=>int(a.methodId,1,2147483647)&&a.methodId!==clearingMethodId&&activeMethodIds.includes(a.methodId)&&int(a.amountMinor,1,maxMoney)))return fail('INVALID_ALLOCATION');
 if(new Set(allocations.map(a=>a.methodId)).size!==allocations.length)return fail('DUPLICATE_METHOD');
 if(allocations.reduce((sum,a)=>sum+a.amountMinor,0)!==total)return fail('PAYMENT_MISMATCH');
 if(total===0){
 if(!input.allowZeroPaymentPreview)return fail('ZERO_PAYMENT_NOT_APPROVED');
 return {ok:true,plan:{mode:'NO_PAYMENT',grandTotalMinor:0,headerMethodId:null,allocations:[],createPaymentRows:false,createCashMovement:false,redistributeClearing:false,previewOnly:true}};
 }
 if(!allocations.length)return fail('PAYMENT_MISMATCH');
 const split=allocations.length>1;
 return {ok:true,plan:{mode:split?'SPLIT':'DIRECT',grandTotalMinor:total,headerMethodId:split?clearingMethodId:allocations[0]!.methodId,allocations:allocations.map(a=>({...a})),createPaymentRows:true,createCashMovement:true,redistributeClearing:split,previewOnly:true}};
}
