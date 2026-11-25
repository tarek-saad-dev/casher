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
