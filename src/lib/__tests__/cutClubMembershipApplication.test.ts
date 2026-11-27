import {describe,it,expect} from 'vitest';
import {parseApplication,parseApplicationDecision} from '@/lib/cut-club/membershipApplication';
describe('membership application commands',()=>{
 it('accepts only a published revision and permitted branch, never caller ownership',()=>{
 const x={code:'STUDENT_01',publicationRevision:1,branchId:3};
 expect(parseApplication(x)).toEqual(x);
 for(const patch of [{accountId:'other'},{benefitsEnabled:true},{branchId:2},{publicationRevision:0},{proof:'image'}])expect(parseApplication({...x,...patch})).toBeNull();
 });
 it('decisions cannot grant membership or benefits',()=>{
 const x={id:'22222222-2222-4222-8222-222222222222',decision:'ACCEPTED_FOR_REVIEW',reason:'review request'};
 expect(parseApplicationDecision(x)).toEqual(x);
 expect(parseApplicationDecision({...x,decision:'ACTIVE'})).toBeNull();
 expect(parseApplicationDecision({...x,discount:10})).toBeNull();
 });
});
