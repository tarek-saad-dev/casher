import {describe,it,expect} from 'vitest';
import {parseBenefitApproval} from '@/lib/cut-club/membershipBenefitApproval';
describe('benefit approval commands',()=>{
 it('requires explicit immutable revision pins and reason',()=>{
 const v={action:'APPROVE',programCode:'STUDENT',programRevision:1,publicationRevision:2,benefitRevision:1,expectedRevision:0,reason:'review complete'};
 expect(parseBenefitApproval(v)).toEqual(v);
 for(const patch of [{publicationRevision:0},{benefitRevision:0},{reason:'x'},{benefitsEnabled:true},{action:'REVOKE'}])expect(parseBenefitApproval({...v,...patch})).toBeNull();
 expect(parseBenefitApproval({...v,action:'REVOKE',expectedRevision:1})).not.toBeNull();
 });
});
