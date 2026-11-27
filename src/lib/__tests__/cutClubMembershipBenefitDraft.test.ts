import {describe,it,expect} from 'vitest';
import {parseBenefitDraft} from '@/lib/cut-club/membershipBenefitDraft';
const rule={code:'HAIR',kind:'PERCENT_DISCOUNT',serviceId:9,value:1250,maxUsesPerMembership:3,maxUsesPerInvoice:1,branchIds:[1,3]};
const draft={programCode:'STUDENTS',programRevision:1,expectedRevision:0,reason:'proposal only',rules:[rule]};
describe('membership benefit configuration',()=>{
 it('supports percent basis points, fixed minor units, free service and bonus coins without enabling them',()=>{
 expect(parseBenefitDraft(draft)).toEqual(draft);
 for(const v of [{kind:'FREE_SERVICE',value:0},{kind:'FIXED_PRICE',value:15000},{kind:'BONUS_COINS',value:10},{value:10000}])expect(parseBenefitDraft({...draft,rules:[{...rule,...v}]})).not.toBeNull();
 });
 it('rejects excessive discounts, invalid limits, nonpilot branches, conflicting service rules and financial overrides',()=>{
 for(const v of [{value:10001},{value:-1},{value:1.5},{maxUsesPerMembership:0},{maxUsesPerInvoice:4},{branchIds:[2]},{branchIds:[1,1]},{serviceId:0},{kind:'FREE_SERVICE',value:1},{kind:'FIXED_PRICE',value:0},{kind:'BONUS_COINS',value:0},{enabled:true}])expect(parseBenefitDraft({...draft,rules:[{...rule,...v}]})).toBeNull();
 expect(parseBenefitDraft({...draft,rules:[rule,{...rule,code:'OTHER'}]})).toBeNull();
 expect(parseBenefitDraft({...draft,benefitsEnabled:true})).toBeNull();
 });
 it('allows an explicit empty draft to remove proposed rules, never an implicit unlimited count',()=>expect(parseBenefitDraft({...draft,rules:[]})).not.toBeNull());
});
