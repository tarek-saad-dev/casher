import {describe,it,expect} from 'vitest';
import {parseProofCommand} from '@/lib/cut-club/membershipProof';
const now=new Date('2026-11-27T10:00:00Z');
const base={action:'APPROVE',accountId:'11111111-1111-4111-8111-111111111111',kind:'STUDENT',expectedRevision:0,expectedClientId:7,reviewedInPerson:true,partnerCode:'UNI',expiresAt:'2027-01-01T00:00:00.000Z',reason:'reviewed in person'};
describe('membership evidence command',()=>{
 it('requires explicit in-person review, linked account and future expiry',()=>{
 expect(parseProofCommand(base,now)).not.toBeNull();
 for(const patch of [{reviewedInPerson:false},{expectedClientId:0},{expiresAt:now.toISOString()},{expiresAt:'2027-02-30T00:00:00.000Z'},{kind:'GENERAL'},{kind:'GOOGLE_REVIEW'},{discount:10},{tenantId:'foreign'}])expect(parseProofCommand({...base,...patch},now)).toBeNull();
 });
 it('revocation is a new revision without financial fields or raw documents',()=>{
 const revoke={action:'REVOKE',accountId:base.accountId,kind:'STUDENT',expectedRevision:1,reason:'incorrect proof'};
 expect(parseProofCommand(revoke,now)).not.toBeNull();
 expect(parseProofCommand({...revoke,expectedRevision:0},now)).toBeNull();
 expect(parseProofCommand({...revoke,documentImage:'image'},now)).toBeNull();
 });
});
