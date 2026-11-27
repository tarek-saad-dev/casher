import {describe,it,expect} from 'vitest';
import {planMembershipSettlementPreview,type SettlementProposal} from '@/lib/cut-club/membershipPosSettlementPreview';
const p:SettlementProposal={
 lines:[{serviceId:9,qty:2,catalog:{id:9,name:'Hair cut',priceMinor:20001},bonus:0,existingDiscountMinor:0,existingDiscountBps:0},{serviceId:39,qty:1,catalog:{id:39,name:'Face mask',priceMinor:5000},bonus:0,existingDiscountMinor:0,existingDiscountBps:0}],
 rule:{code:'HAIR',serviceId:9,kind:'PERCENT_DISCOUNT',value:1250,maxUsesPerMembership:3,maxUsesPerInvoice:2,branchIds:[1]},branchId:1,usedMembership:0,headerDiscountMinor:0,headerDiscountBps:0,paymentMinor:[20000,20002]
};
describe('membership settlement plan preview',()=>{
 it('reconciles the existing POS totals with an exact minor-unit quote and split payment',()=>{
 const r=planMembershipSettlementPreview(p);expect(r).toMatchObject({ok:true,previewOnly:true,financialWritesEnabled:false,lineIndex:0,remainingAfter:1,computed:{subTotal:450.02,lineDiscountTotal:50,grandTotal:400.02,headerDiscountValue:0}});
 });
 it('rejects stale capacity, stacked discounts, duplicate target lines and price mismatches',()=>{
 expect(planMembershipSettlementPreview({...p,usedMembership:2})).toEqual({ok:false,code:'BENEFIT_LIMIT_OR_PRICE'});
 expect(planMembershipSettlementPreview({...p,headerDiscountBps:1})).toEqual({ok:false,code:'STACKING_NOT_SUPPORTED'});
 expect(planMembershipSettlementPreview({...p,lines:[p.lines[0]!,{...p.lines[1]!,existingDiscountMinor:1}]})).toEqual({ok:false,code:'STACKING_NOT_SUPPORTED'});
 expect(planMembershipSettlementPreview({...p,lines:[...p.lines,p.lines[0]!]})).toEqual({ok:false,code:'SERVICE_AMBIGUOUS'});
 expect(planMembershipSettlementPreview({...p,paymentMinor:[40001]})).toEqual({ok:false,code:'PAYMENT_TOTAL_MISMATCH'});
 });
 it('supports a free line alongside paid lines, but not zero-payment invoices or bonus settlement yet',()=>{
 const free={...p.rule,kind:'FREE_SERVICE' as const,value:0};
 expect(planMembershipSettlementPreview({...p,rule:free,paymentMinor:[5000]})).toMatchObject({ok:true,computed:{grandTotal:50}});
 expect(planMembershipSettlementPreview({...p,lines:[p.lines[0]!],rule:free,paymentMinor:[1]})).toEqual({ok:false,code:'ZERO_TOTAL_NOT_SUPPORTED'});
 expect(planMembershipSettlementPreview({...p,rule:{...p.rule,kind:'BONUS_COINS',value:20}})).toEqual({ok:false,code:'BONUS_SETTLEMENT_NOT_SUPPORTED'});
 });
 it('rejects unsupported legacy precision and invalid values',()=>{
 expect(planMembershipSettlementPreview({...p,lines:[{...p.lines[0]!,catalog:{...p.lines[0]!.catalog,priceMinor:100000000}}],rule:{...p.rule,kind:'FREE_SERVICE',value:0}})).toEqual({ok:false,code:'LEGACY_COLUMN_LIMIT'});
 expect(planMembershipSettlementPreview({...p,lines:[{...p.lines[0]!,qty:1.5}]})).toEqual({ok:false,code:'INVALID_INPUT'});
 });
});
