import {describe,it,expect} from 'vitest';
import {parseApplicationTrialInput} from '@/lib/cut-club/membershipTrial';
describe('request-bound trial command',()=>{
 it('only accepts request id and action; caller cannot choose client, program or branch',()=>{
 const now=new Date('2026-11-27T00:00:00Z'),v={applicationId:'22222222-2222-4222-8222-222222222222',action:'ISSUE',expectedTrialRevision:0,expiresAt:'2026-12-01T00:00:00.000Z',reason:'review complete'};
 expect(parseApplicationTrialInput(v,now)).toEqual(v);
 for(const extra of [{accountId:v.applicationId},{programCode:'OTHER'},{branchId:3},{discount:10}])expect(parseApplicationTrialInput({...v,...extra},now)).toBeNull();
 });
});
