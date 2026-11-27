import {describe,it,expect} from 'vitest';
import {previewBenefit} from '@/lib/cut-club/membershipBenefitPreview';
import type {BenefitRule} from '@/lib/cut-club/membershipBenefitDraft';
const rule:BenefitRule={code:'HAIR',kind:'PERCENT_DISCOUNT',serviceId:9,value:1250,maxUsesPerMembership:3,maxUsesPerInvoice:2,branchIds:[1]};
const service={id:9,name:'Hair cut',priceMinor:20001};
describe('nonfinancial benefit preview',()=>{
 it('uses integer minor units and rounds discounts down',()=>expect(previewBenefit(rule,service,1,2,0,0)).toEqual({originalMinor:40002,discountMinor:5000,finalMinor:35002,bonusCoins:0,units:2,previewOnly:true}));
 it('never discounts below zero, raises fixed prices, or exceeds explicit limits',()=>{
 expect(previewBenefit({...rule,value:10001},service,1,1,0,0)).toBeNull();
 expect(previewBenefit({...rule,kind:'FIXED_PRICE',value:20002},service,1,1,0,0)).toBeNull();
 expect(previewBenefit(rule,service,1,2,2,0)).toBeNull();
 expect(previewBenefit(rule,service,1,2,0,1)).toBeNull();
 expect(previewBenefit(rule,service,3,1,0,0)).toBeNull();
 expect(previewBenefit({...rule,kind:'FREE_SERVICE',value:0},service,1,1,0,0)?.finalMinor).toBe(0);
 expect(previewBenefit({...rule,kind:'BONUS_COINS',value:10},service,1,1,0,0)?.bonusCoins).toBe(10);
 });
});
