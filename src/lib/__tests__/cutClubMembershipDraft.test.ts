import {describe,it,expect} from 'vitest';
import {parseMembershipDraft} from '@/lib/cut-club/membershipDraft';
const valid={code:'STUDENTS_01',expectedRevision:0,title:'طلاب',kind:'STUDENT',minimumVisits:0,allowedBranchIds:[3,1],partnerCode:'UNI',reason:'initial draft'};
describe('membership draft write contract',()=>{
 it('canonicalizes branch scope and labels',()=>expect(parseMembershipDraft(valid)).toEqual({...valid,allowedBranchIds:[1,3]}));
 it('does not accept an activation, benefit, customer or caller tenant',()=>{
  for(const extra of [{enabled:true},{discount:20},{tenantId:'other'},{clientId:1},{status:'PUBLISHED'}])expect(parseMembershipDraft({...valid,...extra})).toBeNull();
 });
 it('rejects invalid scope, revisions, reasons, and program categories',()=>{
  for(const bad of [{allowedBranchIds:[]},{allowedBranchIds:[2]},{allowedBranchIds:[1,1]},{expectedRevision:-1},{reason:'x'},{kind:'GENERAL'},{kind:'REVIEW'},{minimumVisits:-1}])expect(parseMembershipDraft({...valid,...bad})).toBeNull();
 });
});
