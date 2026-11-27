import { describe, expect, it, vi, afterEach } from 'vitest';
import { normalizeSignupOtpPhone, readSignupChallenge, signSignupChallenge, signupOtpConfig, signupOtpRequired, sendSignupOtp, verifySignupOtp } from '@/platform/publicSignup/otp';

const config = { baseUrl: 'https://otp.example.test', apiKey: 'a'.repeat(40), signingKey: 'b'.repeat(40) };
const phone = '201012345678';
const challengeId = 'f39cbb94-8500-4358-a64e-2ecceaf63343';
const challenge = () => ({ phone, challengeId, expiresAt: Date.now() + 240000, purpose: 'SIGNUP' as const });
afterEach(() => vi.unstubAllGlobals());

describe('platform signup OTP', () => {
  it('is opt-in and never falls back to existing tenant credentials', () => {
    expect(signupOtpRequired({})).toBe(false);
    expect(signupOtpRequired({ PUBLIC_SIGNUP_OTP_REQUIRED: 'true' })).toBe(true);
    expect(() => signupOtpConfig({ DRVOWA_BASE_URL: config.baseUrl, DRVOWA_INBOUND_API_KEY: config.apiKey })).toThrow();
    expect(() => signupOtpConfig({ PUBLIC_SIGNUP_OTP_BASE_URL: config.baseUrl, PUBLIC_SIGNUP_OTP_API_KEY: config.apiKey, PUBLIC_SIGNUP_OTP_SIGNING_KEY: config.signingKey })).toThrow();
    expect(signupOtpConfig({ PUBLIC_SIGNUP_OTP_BASE_URL: config.baseUrl, PUBLIC_SIGNUP_OTP_API_KEY: config.apiKey, PUBLIC_SIGNUP_OTP_SIGNING_KEY: config.signingKey, PUBLIC_SIGNUP_OTP_EDGE_RATE_LIMIT_READY: 'true' })).toEqual(config);
  });
  it('normalizes the same owner phone and rejects malformed numbers', () => {
    expect(normalizeSignupOtpPhone('01012345678')).toBe(phone);
    expect(normalizeSignupOtpPhone('+20 1012345678')).toBe(phone);
    expect(() => normalizeSignupOtpPhone('01012345678x')).toThrow();
  });
  it('rejects tampering, expiration, wrong phone and wrong key', () => {
    const signed = signSignupChallenge(challenge(), config.signingKey);
    expect(readSignupChallenge(signed, phone, config.signingKey).challengeId).toBe(challengeId);
    expect(() => readSignupChallenge(signed + 'x', phone, config.signingKey)).toThrow();
    expect(() => readSignupChallenge(signed, '201112345678', config.signingKey)).toThrow();
    expect(() => readSignupChallenge(signed, phone, 'other-key')).toThrow();
    expect(() => readSignupChallenge(signed, phone, config.signingKey, Date.now() + 300000)).toThrow();
  });
  it('accepts only confirmed send and returns no integration secrets or raw code', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'SENT', challengeId, expiresAtUtc: new Date(Date.now() + 240000).toISOString(), resendAfterSec: 60 })));
    vi.stubGlobal('fetch', fetcher);
    const response = await sendSignupOtp(phone, config);
    expect(Object.keys(response).sort()).toEqual(['expiresAtUtc', 'resendAfterSec', 'ticket']);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ phone, purpose: 'SIGNUP' });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'UNKNOWN', challengeId, expiresAtUtc: new Date(Date.now() + 240000).toISOString() })));
    await expect(sendSignupOtp(phone, config)).rejects.toThrow();
  });
  it('requires proof and matches provider verification purpose and phone', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ verified: true, phoneNormalized: phone, purpose: 'SIGNUP' })));
    vi.stubGlobal('fetch', fetcher);
    const ticket = signSignupChallenge(challenge(), config.signingKey);
    await expect(verifySignupOtp(phone, undefined, config)).rejects.toThrow();
    await expect(verifySignupOtp(phone, { ticket, code: 'abc123' }, config)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(verifySignupOtp(phone, { ticket, code: '123456' }, config)).resolves.toBeUndefined();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ verified: true, phoneNormalized: phone, purpose: 'LOGIN' })));
    await expect(verifySignupOtp(phone, { ticket, code: '123456' }, config)).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    await expect(verifySignupOtp(phone, { ticket, code: '123456' }, config)).rejects.toThrow();
  });
});

import { enforceOperatorOtpRate, operatorOtpConfig, operatorOtpStatus } from '@/platform/publicSignup/otpOperator';
import { readFileSync } from 'node:fs';

describe('platform operator OTP diagnostics', () => {
  const env = { PUBLIC_SIGNUP_OTP_BASE_URL: 'https://otp.example.test', PUBLIC_SIGNUP_OTP_API_KEY: 'a'.repeat(40), PUBLIC_SIGNUP_OTP_SIGNING_KEY: 'b'.repeat(40), PUBLIC_SIGNUP_OTP_EDGE_RATE_LIMIT_READY: 'true' };
  it('reports only booleans and does not infer live connectivity', () => {
    expect(operatorOtpStatus(env)).toEqual({ required:false, configured:true, publicConfigured:true, senderKeyPresent:true, independentSigningKeyPresent:true, edgeRateLimitDeclared:true, providerUrlPresent:true });
    expect(operatorOtpStatus({})).toMatchObject({ required:false, configured:false, senderKeyPresent:false });
    expect(JSON.stringify(operatorOtpStatus(env))).not.toContain(env.PUBLIC_SIGNUP_OTP_API_KEY);
  });
  it('allows isolated operator testing without declaring public edge protection', () => {
    const unprotected = { ...env, PUBLIC_SIGNUP_OTP_EDGE_RATE_LIMIT_READY: 'false' };
    expect(operatorOtpStatus(unprotected)).toMatchObject({ required:false, configured:true, publicConfigured:false, edgeRateLimitDeclared:false });
    expect(() => signupOtpConfig(unprotected)).toThrow();
    const cfg = operatorOtpConfig(unprotected);
    expect(cfg.signingKey).not.toBe(env.PUBLIC_SIGNUP_OTP_SIGNING_KEY);
    expect(() => operatorOtpConfig({ ...unprotected, PUBLIC_SIGNUP_OTP_BASE_URL: 'http://otp.example.test' })).toThrow();
    expect(() => operatorOtpConfig({ ...unprotected, PUBLIC_SIGNUP_OTP_API_KEY: '' })).toThrow();
  });
  it('limits authenticated operators independently of IP and resets after a minute', () => {
    for (let i=0;i<3;i++) enforceOperatorOtpRate('test-operator', 'send', 1000);
    expect(() => enforceOperatorOtpRate('test-operator', 'send', 1000)).toThrow();
    expect(() => enforceOperatorOtpRate('other-operator', 'send', 1000)).not.toThrow();
    expect(() => enforceOperatorOtpRate('test-operator', 'send', 61000)).not.toThrow();
  });
  it('separates operator test signatures from public signup signatures', () => {
    const cfg = operatorOtpConfig(env);
    const phone = '201012345678';
    const ticket = signSignupChallenge({phone,challengeId:'f39cbb94-8500-4358-a64e-2ecceaf63343',expiresAt:Date.now()+60000,purpose:'SIGNUP'},cfg.signingKey);
    expect(() => readSignupChallenge(ticket,phone,env.PUBLIC_SIGNUP_OTP_SIGNING_KEY)).toThrow();
    expect(readSignupChallenge(ticket,phone,cfg.signingKey).phone).toBe(phone);
  });
  it('gates both endpoints and never provisions a tenant', () => {
    const source=readFileSync('src/app/api/admin/platform/authentication/otp/route.ts','utf8');
    expect(source.match(/await requirePlatformOperator\(\)/g)).toHaveLength(2);
    expect(source).not.toContain('provisionPublicSignup');
    expect(source).toContain('operatorOtpConfig()');
  });
});
