import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolvePublicBookingClientIp } from '@/lib/booking/publicBookingClientIp';

export const SIGNUP_OTP_PURPOSE = 'SIGNUP';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^201[0125]\d{8}$/;
const MAX_TTL_MS = 300_000;

export class SignupOtpError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
  }
}
const unavailable = () => new SignupOtpError('OTP_UNAVAILABLE', 503, 'خدمة التحقق غير متاحة مؤقتًا. جرّب تاني.');
const invalid = () => new SignupOtpError('OTP_INVALID', 400, 'رمز التحقق غير صحيح أو انتهت صلاحيته.');

type Config = { baseUrl: string; apiKey: string; signingKey: string };
export function signupOtpRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUBLIC_SIGNUP_OTP_REQUIRED === 'true';
}

/** Dedicated platform pairing only. Never resolve a tenant/CUT CLUB integration or legacy fallback. */
export function signupOtpConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env.PUBLIC_SIGNUP_OTP_EDGE_RATE_LIMIT_READY !== 'true') throw unavailable();
  return signupOtpProviderConfig(env);
}

/** Shared provider credentials validation only. Public callers must use signupOtpConfig. */
export function signupOtpProviderConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env.PUBLIC_SIGNUP_OTP_API_KEY?.trim();
  const signingKey = env.PUBLIC_SIGNUP_OTP_SIGNING_KEY?.trim();
  const raw = env.PUBLIC_SIGNUP_OTP_BASE_URL?.trim();
  if (!apiKey || apiKey.length < 32 || !signingKey || signingKey.length < 32 || apiKey === signingKey ||
      !raw) throw unavailable();
  let url: URL;
  try { url = new URL(raw); } catch { throw unavailable(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw unavailable();
  return { baseUrl: url.origin, apiKey, signingKey };
}

export function normalizeSignupOtpPhone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32 || !/^[+\d\s().-]+$/.test(value)) {
    throw new SignupOtpError('PHONE_INVALID', 400, 'اكتب رقم موبايل مصري صحيح.');
  }
  const digits = value.replace(/\D/g, '');
  const phone = /^01[0125]\d{8}$/.test(digits) ? '2' + digits : digits.startsWith('0020') ? digits.slice(2) : digits;
  if (!PHONE.test(phone)) throw new SignupOtpError('PHONE_INVALID', 400, 'اكتب رقم موبايل مصري صحيح.');
  return phone;
}

type Challenge = { phone: string; challengeId: string; expiresAt: number; purpose: typeof SIGNUP_OTP_PURPOSE };
function mac(payload: string, key: string) {
  return createHmac('sha256', key).update('drvo-platform-signup-v1:').update(payload).digest('base64url');
}
export function signSignupChallenge(challenge: Challenge, key: string): string {
  const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url');
  return payload + '.' + mac(payload, key);
}
export function readSignupChallenge(ticket: unknown, phone: string, key: string, now = Date.now()): Challenge {
  if (typeof ticket !== 'string' || ticket.length > 1024 || !/^[\w-]+\.[\w-]+$/.test(ticket)) throw invalid();
  const [payload, signature] = ticket.split('.');
  const expected = Buffer.from(mac(payload, key));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw invalid();
  let challenge: Challenge;
  try { challenge = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw invalid(); }
  if (!challenge || challenge.phone !== phone || challenge.purpose !== SIGNUP_OTP_PURPOSE ||
      !UUID.test(challenge.challengeId) || !Number.isFinite(challenge.expiresAt) ||
      challenge.expiresAt <= now || challenge.expiresAt > now + MAX_TTL_MS) throw invalid();
  return challenge;
}

// Per-process defence in depth only; the deployment MUST enforce a trusted-IP
// edge limit as well. Provider enforces durable per-phone, business and attempts.
type Bucket = { count: number; until: number };
const hits = new Map<string, Bucket>();
export function enforceSignupOtpRate(req: Request, action: 'send' | 'verify', now = Date.now()) {
  const ip = resolvePublicBookingClientIp(req);
  const key = action + ':' + ip;
  for (const [k, b] of hits) if (b.until <= now) hits.delete(k);
  if (!hits.has(key) && hits.size >= 4096) throw unavailable();
  const bucket = hits.get(key) ?? { count: 0, until: now + 60_000 };
  bucket.count += 1; hits.set(key, bucket);
  if (bucket.count > (action === 'send' ? 3 : 10))
    throw new SignupOtpError('OTP_RATE_LIMITED', 429, 'طلبات كتير. استنى دقيقة وحاول تاني.');
}

async function provider(config: Config, action: 'send' | 'verify', body: object): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(config.baseUrl + '/api/external/v1/otp/' + action, {
      method: 'POST', headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch { throw unavailable(); }
  if (response.status === 429) throw new SignupOtpError('OTP_RATE_LIMITED', 429, 'طلبات كتير. حاول بعد شوية.');
  if (!response.ok) {
    if (action === 'verify' && [400, 409, 410].includes(response.status)) throw invalid();
    throw unavailable();
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw unavailable();
  return data;
}

export async function sendSignupOtp(rawPhone: unknown, config = signupOtpConfig()) {
  const phone = normalizeSignupOtpPhone(rawPhone);
  const data = await provider(config, 'send', { phone, purpose: SIGNUP_OTP_PURPOSE, requestId: randomUUID() });
  const expiresAt = typeof data.expiresAtUtc === 'string' ? Date.parse(data.expiresAtUtc) : NaN;
  // Only a definitively SENT challenge can be used. The provider's UNKNOWN path
  // is deliberately not accepted for platform signup.
  if (data.status !== 'SENT' || typeof data.challengeId !== 'string' || !UUID.test(data.challengeId) ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + MAX_TTL_MS)
    throw unavailable();
  const resendAfterSec = typeof data.resendAfterSec === 'number' && Number.isFinite(data.resendAfterSec)
    ? Math.max(60, Math.min(300, Math.ceil(data.resendAfterSec))) : 60;
  return { ticket: signSignupChallenge({ phone, challengeId: data.challengeId, expiresAt, purpose: SIGNUP_OTP_PURPOSE }, config.signingKey), expiresAtUtc: new Date(expiresAt).toISOString(), resendAfterSec };
}

/** Verification is consumed at the provider in the provisioning request itself.
 * No separate reusable "verified" browser token is issued. */
export async function verifySignupOtp(phone: string, proof: unknown, config = signupOtpConfig()): Promise<void> {
  const normalized = normalizeSignupOtpPhone(phone);
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw invalid();
  const { ticket, code } = proof as Record<string, unknown>;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalid();
  const challenge = readSignupChallenge(ticket, normalized, config.signingKey);
  const data = await provider(config, 'verify', { phone: normalized, purpose: SIGNUP_OTP_PURPOSE, challengeId: challenge.challengeId, code });
  if (data.verified !== true || data.phoneNormalized !== normalized || data.purpose !== SIGNUP_OTP_PURPOSE) throw invalid();
}
