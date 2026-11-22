/**
 * DRVO Salon interim launch: public self-service provisioning is explicitly opt-in.
 *
 * This is an availability switch, NOT identity verification, Tenant isolation proof,
 * billing approval, or permission to invite real salons. It defaults OFF in every env.
 */
export const PUBLIC_SIGNUP_DISABLED = {
  code: 'PUBLIC_SIGNUP_NOT_LAUNCHED',
  message: 'التسجيل العام لسه غير متاح. تواصل مع فريق DRVO لتجربة خاصة.',
} as const;

export function isPublicSignupEnabled(
  env: { DRVO_PUBLIC_SIGNUP_ENABLED?: string } = process.env,
): boolean {
  return env.DRVO_PUBLIC_SIGNUP_ENABLED === 'true';
}
