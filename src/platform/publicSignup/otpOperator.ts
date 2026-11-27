import 'server-only';
import { createHmac } from 'node:crypto';
import { signupOtpConfig, signupOtpProviderConfig, signupOtpRequired, SignupOtpError } from './otp';

export function operatorOtpStatus(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.PUBLIC_SIGNUP_OTP_API_KEY?.trim();
  const signingKey = env.PUBLIC_SIGNUP_OTP_SIGNING_KEY?.trim();
  let configured = false, publicConfigured = false;
  try { operatorOtpConfig(env); configured = true; } catch { /* configuration unavailable */ }
  try { signupOtpConfig(env); publicConfigured = true; } catch { /* public gate unavailable */ }
  return {
    required: signupOtpRequired(env),
    configured,
    publicConfigured,
    senderKeyPresent: !!apiKey && apiKey.length >= 32,
    independentSigningKeyPresent: !!signingKey && signingKey.length >= 32 && signingKey !== apiKey,
    edgeRateLimitDeclared: env.PUBLIC_SIGNUP_OTP_EDGE_RATE_LIMIT_READY === 'true',
    providerUrlPresent: !!env.PUBLIC_SIGNUP_OTP_BASE_URL?.trim(),
  };
}

/** A test ticket must never be usable to provision a public signup. */
export function operatorOtpConfig(env: NodeJS.ProcessEnv = process.env) {
  const cfg = signupOtpProviderConfig(env);
  return { ...cfg, signingKey: createHmac('sha256', cfg.signingKey).update('platform-operator-otp-test-v1').digest('hex') };
}

// Authenticated operator-specific limit, independent of untrusted IP headers.
const operatorHits = new Map<string, { count: number; until: number }>();
export function enforceOperatorOtpRate(userId: string | number, action: 'send' | 'verify', now = Date.now()) {
  const key = action + ':' + String(userId);
  for (const [id, bucket] of operatorHits) if (bucket.until <= now) operatorHits.delete(id);
  if (!operatorHits.has(key) && operatorHits.size >= 1024) throw new SignupOtpError('OTP_UNAVAILABLE', 503, 'خدمة الاختبار غير متاحة مؤقتًا.');
  const bucket = operatorHits.get(key) ?? { count: 0, until: now + 60_000 };
  bucket.count += 1;
  operatorHits.set(key, bucket);
  if (bucket.count > (action === 'send' ? 3 : 10)) throw new SignupOtpError('OTP_RATE_LIMITED', 429, 'طلبات كتير. استنى دقيقة وحاول تاني.');
}
