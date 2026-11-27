import {describe,it,expect} from 'vitest';
import {planMembershipPayment} from '@/lib/cut-club/membershipPaymentPlan';
const context={activeMethodIds:[1,2,3],clearingMethodId:3,allowZeroPaymentPreview:false};
describe('membership payment plan preview',()=>{
 it('plans an exact direct or split payment, never accepts clearing from caller',()=>{
 expect(planMembershipPayment({...context,grandTotalMinor:20001,allocations:[{methodId:1,amountMinor:20001}]})).toMatchObject({ok:true,plan:{mode:'DIRECT',headerMethodId:1,createPaymentRows:true,createCashMovement:true,redistributeClearing:false}});
 expect(planMembershipPayment({...context,grandTotalMinor:20001,allocations:[{methodId:1,amountMinor:10000},{methodId:2,amountMinor:10001}]})).toMatchObject({ok:true,plan:{mode:'SPLIT',headerMethodId:3,redistributeClearing:true}});
 expect(planMembershipPayment({...context,grandTotalMinor:20001,allocations:[{methodId:3,amountMinor:20001}]})).toEqual({ok:false,code:'INVALID_ALLOCATION'});
 });
 it('represents a free invoice without a fabricated payment, movement or clearing transfer',()=>{
 expect(planMembershipPayment({...context,grandTotalMinor:0,allocations:[]})).toEqual({ok:false,code:'ZERO_PAYMENT_NOT_APPROVED'});
 expect(planMembershipPayment({...context,allowZeroPaymentPreview:true,grandTotalMinor:0,allocations:[]})).toEqual({ok:true,plan:{mode:'NO_PAYMENT',grandTotalMinor:0,headerMethodId:null,allocations:[],createPaymentRows:false,createCashMovement:false,redistributeClearing:false,previewOnly:true}});
 expect(planMembershipPayment({...context,allowZeroPaymentPreview:true,grandTotalMinor:0,allocations:[{methodId:1,amountMinor:1}]})).toEqual({ok:false,code:'PAYMENT_MISMATCH'});
 });
 it('rejects negative, fractional, unknown, duplicated or one-cent-mismatched allocations',()=>{
 for(const a of [{methodId:1,amountMinor:-1},{methodId:1,amountMinor:0.5},{methodId:9,amountMinor:100}])expect(planMembershipPayment({...context,grandTotalMinor:100,allocations:[a]})).toEqual({ok:false,code:'INVALID_ALLOCATION'});
 expect(planMembershipPayment({...context,grandTotalMinor:100,allocations:[{methodId:1,amountMinor:50},{methodId:1,amountMinor:50}]})).toEqual({ok:false,code:'DUPLICATE_METHOD'});
 expect(planMembershipPayment({...context,grandTotalMinor:100,allocations:[{methodId:1,amountMinor:99}]})).toEqual({ok:false,code:'PAYMENT_MISMATCH'});
 });
});
