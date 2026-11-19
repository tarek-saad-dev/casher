import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({
  send:vi.fn(),verify:vi.fn(),getPool:vi.fn(),
}));
vi.mock('@/lib/db',()=>({getPool:mocks.getPool,sql:{
  Char:vi.fn((x)=>'Char'+x),NVarChar:vi.fn((x)=>'NVarChar'+x),
  VarChar:vi.fn((x)=>'VarChar'+x),UniqueIdentifier:'uuid',
  DateTime2:'dt2',Int:'int',
}}));
vi.mock('@/lib/integrations/drvowaClient',()=>({
  sendDrvowaCutClubOtp:mocks.send,verifyDrvowaCutClubOtp:mocks.verify,
}));
import {
  normalizeCutClubPhone,digestToken,newOpaque,secureBffKey,cutClubTenant,
  validPurpose,startCutClubOtp,verifyCutClubOtp,getCutClubSession,ClubAuthError,
} from '../cut-club/memberOtp';

const strongKey='this-test-shared-bff-key-with-more-than-32-chars';
const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
describe('CUT CLUB production OTP foundations',()=>{
  beforeEach(()=>{
    mocks.send.mockReset();mocks.verify.mockReset();mocks.getPool.mockReset();
    process.env.CUT_CLUB_MEMBER_WALLET_ENABLED='true';
    process.env.CUT_CLUB_AUTH_TENANT_ID=tenant;
  });
  it('normalizes exactly Egyptian mobile numbers and rejects unsupported identifiers',()=>{
    expect(normalizeCutClubPhone('01557994946')).toBe('201557994946');
    expect(normalizeCutClubPhone('+201557994946')).toBe('201557994946');
    expect(normalizeCutClubPhone('00201557994946')).toBe('201557994946');
    expect(normalizeCutClubPhone('201557994946')).toBe('201557994946');
    expect(normalizeCutClubPhone('01112345678')).toBe('201112345678');
    expect(normalizeCutClubPhone('12345')).toBeNull();
    expect(normalizeCutClubPhone('not-a-phone')).toBeNull();
    expect(normalizeCutClubPhone('0101234567899')).toBeNull();
    expect(normalizeCutClubPhone('02012345678')).toBeNull();
    expect(normalizeCutClubPhone({clientId:1})).toBeNull();
  });
  it('requires a real enabled tenant AND a constant-time BFF credential',()=>{
    expect(cutClubTenant()).toBe(tenant);
    const env={CUT_CLUB_MEMBER_WALLET_ENABLED:'true',CUT_CLUB_BFF_SHARED_KEY:strongKey} as NodeJS.ProcessEnv;
    expect(secureBffKey('Bearer '+strongKey,env)).toBe(true);
    expect(secureBffKey('Bearer bad',env)).toBe(false);
    expect(secureBffKey(null,env)).toBe(false);
    expect(secureBffKey('Bearer '+strongKey,{...env,CUT_CLUB_MEMBER_WALLET_ENABLED:'false'})).toBe(false);
    expect(secureBffKey('Bearer '+strongKey,{...env,CUT_CLUB_BFF_SHARED_KEY:'short'})).toBe(false);
    process.env.CUT_CLUB_MEMBER_WALLET_ENABLED='false';
    expect(()=>cutClubTenant()).toThrow(ClubAuthError);
  });
  it('allows only the two DRVO purposes and produces cryptographically opaque digest-only tokens',()=>{
    expect(validPurpose('LOGIN')).toBe(true);
    expect(validPurpose('CUT_CLUB_SIGNUP')).toBe(true);
    expect(validPurpose('PHONE_CHANGE')).toBe(false);
    const a=newOpaque(),b=newOpaque();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(digestToken(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestToken(a)).toBe(digestToken(a));
    expect(digestToken(a)).not.toBe(digestToken(b));
    expect(digestToken(a)).not.toContain(a);
  });
  it('sends OTP only through the existing DRVO backend and stores pending token digest, never OTP',async()=>{
    const written:any[]=[];
    const fakeRequest:any={
      input:vi.fn(function(this:any,...args:any[]){written.push(args);return this;}),
      query:vi.fn(async()=>({recordset:[],rowsAffected:[1]})),
    };
    mocks.getPool.mockResolvedValue({request:()=>fakeRequest});
    mocks.send.mockResolvedValue({
      challengeId:'c2fcb8a7-2539-42e9-8d2a-c4b6cdf32791',
      status:'SENT',expiresAtUtc:new Date(Date.now()+240_000).toISOString(),
      resendAfterSec:60,idempotentReplay:false,
    });
    const response=await startCutClubOtp('01557994946','CUT_CLUB_SIGNUP');
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0]).toMatchObject({phone:'201557994946',purpose:'CUT_CLUB_SIGNUP'});
    expect(response.pendingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response).not.toHaveProperty('code');
    expect(written.some(a=>a[0]==='digest'&&a[2]===digestToken(response.pendingToken))).toBe(true);
    expect(JSON.stringify(written)).not.toContain(response.pendingToken);
    expect(fakeRequest.query).toHaveBeenCalledOnce();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('rejects malformed code/token before any DB or provider call',async()=>{
    await expect(verifyCutClubOtp('clientId=123','123456')).rejects.toThrow('INVALID_OTP');
    await expect(verifyCutClubOtp(newOpaque(),'123')).rejects.toThrow('INVALID_OTP');
    expect(await getCutClubSession('123')).toBeNull();
    expect(mocks.getPool).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
