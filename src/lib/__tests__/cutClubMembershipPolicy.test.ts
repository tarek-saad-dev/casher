import {describe,expect,it} from 'vitest';
import {evaluateMembershipEligibility as evaluate,parseMembershipPreview,type MembershipPolicy,type MemberFacts} from '@/lib/cut-club/membershipPolicy';
const now=new Date('2026-11-27T10:00:00Z');
const policy:MembershipPolicy={kind:'STUDENT',enabled:true,minimumVisits:1,allowedBranchIds:[1,3],partnerCode:'UNI'};
const facts:MemberFacts={accountStatus:'ACTIVE',completedVisits:1,branchId:1,proof:{kind:'STUDENT',verified:true,partnerCode:'UNI',expiresAt:'2027-01-01T00:00:00Z'}};
describe('membership rule preview (no grants)',()=>{
 it('accepts only complete matching verified facts',()=>expect(evaluate(policy,facts,now)).toEqual({eligible:true,reasons:[]}));
 it('blocks disabled programs, suspended/unlinked/review accounts and excluded branches',()=>{
   expect(evaluate({...policy,enabled:false},{...facts,accountStatus:'SUSPENDED',branchId:2},now).reasons).toEqual(['PROGRAM_DISABLED','ACCOUNT_NOT_ACTIVE','BRANCH_NOT_ELIGIBLE']);
   for(const accountStatus of ['UNLINKED','REVIEW_REQUIRED'] as const)expect(evaluate(policy,{...facts,accountStatus},now).eligible).toBe(false);
   expect(evaluate({...policy,allowedBranchIds:[]},facts,now).eligible).toBe(false);
 });
 it('does not treat unknown visits as zero or confirmed evidence',()=>{
   expect(evaluate(policy,{...facts,completedVisits:null},now).reasons).toContain('VISITS_UNVERIFIED');
   expect(evaluate(policy,{...facts,completedVisits:0},now).reasons).toContain('VISITS_INSUFFICIENT');
 });
 it('requires the right approved proof and a nonexpired validity for special memberships',()=>{
   expect(evaluate(policy,{...facts,proof:null},now).reasons).toContain('PROOF_REQUIRED');
   expect(evaluate(policy,{...facts,proof:{...facts.proof!,kind:'DOCTOR'}},now).eligible).toBe(false);
   expect(evaluate(policy,{...facts,proof:{...facts.proof!,verified:false}},now).eligible).toBe(false);
   expect(evaluate(policy,{...facts,proof:{...facts.proof!,expiresAt:now.toISOString(),partnerCode:'OTHER'}},now).reasons).toEqual(['PROOF_EXPIRED','PARTNER_MISMATCH']);
   expect(evaluate(policy,{...facts,proof:{...facts.proof!,expiresAt:null}},now).eligible).toBe(false);
 });
 it('general membership can be previewed without special proof',()=>{
   expect(evaluate({...policy,kind:'GENERAL',partnerCode:null,minimumVisits:0},{...facts,completedVisits:null,proof:null},now).eligible).toBe(true);
 });
 it('rejects malformed, extra, financial and unsupported fields',()=>{
   expect(parseMembershipPreview({policy,facts})).not.toBeNull();
   expect(parseMembershipPreview({policy:{...policy,discount:100},facts})).toBeNull();
   expect(parseMembershipPreview({policy:{...policy,minimumVisits:-1},facts})).toBeNull();
   expect(parseMembershipPreview({policy:{...policy,allowedBranchIds:[1,1]},facts})).toBeNull();
   expect(parseMembershipPreview({policy:{...policy,kind:'REVIEW_REWARD'},facts})).toBeNull();
   expect(parseMembershipPreview({policy,facts:{...facts,proof:{...facts.proof!,expiresAt:'2027-02-30T00:00:00Z'}}})).toBeNull();
 });
});
