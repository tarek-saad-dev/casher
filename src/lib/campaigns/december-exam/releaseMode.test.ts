import {describe,it,expect} from 'vitest';
import {decemberProductionConfigured} from './releaseMode';
const valid={DECEMBER_EXAM_PRODUCTION_ENABLED:'true',DECEMBER_EXAM_RELEASE_APPROVAL:'approved release reference',DECEMBER_EXAM_COMMISSION_POLICY:'LEGACY_SERVICE_BASE',DECEMBER_EXAM_INGRESS_VERIFIED:'true',DECEMBER_EXAM_PRODUCTION_DB_LOGIN:'fixture_app',DECEMBER_EXAM_TENANT_ID:'413d433e-f36b-1410-8820-009ec495c7e1',DECEMBER_EXAM_BFF_SHARED_KEY:'fixture-only-test-key-12345678901234567890'};
describe('December production release boundary',()=>{
 it('defaults closed',()=>expect(decemberProductionConfigured({})).toBe(false));
 it('requires every approval and configuration value',()=>{
  expect(decemberProductionConfigured(valid)).toBe(true);
  for(const field of Object.keys(valid))expect(decemberProductionConfigured({...valid,[field]:''})).toBe(false);
 });
 it('rejects unsupported commission policies and short shared key',()=>{
  expect(decemberProductionConfigured({...valid,DECEMBER_EXAM_COMMISSION_POLICY:'NET'})).toBe(false);
  expect(decemberProductionConfigured({...valid,DECEMBER_EXAM_BFF_SHARED_KEY:'short'})).toBe(false);
 });
});
