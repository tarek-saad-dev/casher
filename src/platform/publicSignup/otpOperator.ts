import 'server-only';
import { createHmac } from 'node:crypto';
import { signupOtpConfig, signupOtpRequired } from './otp';

export function operatorOtpStatus(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.PUBLIC_SIGNUP_OTP_API_KEY?.trim();
  const signingKey = env.PUBLIC_SIGNUP_OTP_SIGNING_KEY?.trim();
  let configured = false;
  try { signupOtpConfig(env); configured = true; } catch { /* configuration unavailable */ }
  return {
    required: signupOtpRequired(env),
    configured,
    senderKeyPresent: !!apiKey && apiKey.length >= 32,
    independentSigningKeyPresent: !!signingKey && signingKey.length >= 32 && signingKey !== apiKey,
    edgeRateLimitDeclared: env.PUBLIC_SIGNUP_OTP_EDGE_RATE_LIMIT_READY === 'true',
    providerUrlPresent: !!env.PUBLIC_SIGNUP_OTP_BASE_URL?.trim(),
  };
}

/** A test ticket must never be usable to provision a public signup. */
export function operatorOtpConfig(env: NodeJS.ProcessEnv = process.env) {
  const cfg = signupOtpConfig(env);
  return { ...cfg, signingKey: createHmac('sha256', cfg.signingKey).update('platform-operator-otp-test-v1').digest('hex') };
}
