/**
 * CUT CLUB customer session verification (Sprint A / #249).
 *
 * VERIFICATION ONLY: no token issuance, OTP sending, public API modification
 * or phone/clientId authentication. Node/server-only module.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const CUT_CLUB_AUDIENCE = "cut-club-customer";
export const CUT_CLUB_ISSUER = "cut-salon-customer-auth";
export const CUT_CLUB_MAX_SESSION_SECONDS = 12 * 60 * 60;

export type VerifiedCustomerSubject = Readonly<{
  customerId: number;
  tenantId: string;
  sessionId: string;
  verificationMethod: "otp";
  verifiedAt: number;
  issuedAt: number;
  expiresAt: number;
}>;

export type CustomerVerification =
  | { ok: true; subject: VerifiedCustomerSubject }
  | { ok: false; reason: "invalid" | "misconfigured" };

type VerifyOptions = Readonly<{
  secret: string | undefined;
  expectedTenantId: string;
  nowSeconds?: number;
}>;

const invalid = (): CustomerVerification => ({ ok: false, reason: "invalid" });
const positiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Verify a future trusted OTP-issued token. Caller must read it from a
 * secure customer-only cookie and MUST resolve tenant from trusted context,
 * not from query parameters or a form field.
 */
export function verifyCutClubCustomerSession(
  token: unknown,
  options: VerifyOptions,
): CustomerVerification {
  const { secret, expectedTenantId } = options;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    return { ok: false, reason: "misconfigured" };
  }
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 4096 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) return invalid();

  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return invalid();

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return invalid();
  }
  if (!object(claims)) return invalid();

  if (
    claims.version !== 1 ||
    claims.audience !== CUT_CLUB_AUDIENCE ||
    claims.issuer !== CUT_CLUB_ISSUER ||
    claims.verificationMethod !== "otp" ||
    !positiveInt(claims.customerId) ||
    typeof claims.tenantId !== "string" ||
    claims.tenantId.trim().length === 0 ||
    claims.tenantId.length > 128 ||
    typeof claims.sessionId !== "string" ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(claims.sessionId) ||
    !positiveInt(claims.verifiedAt) ||
    !positiveInt(claims.issuedAt) ||
    !positiveInt(claims.expiresAt)
  ) return invalid();

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!positiveInt(now)) return invalid();
  if (
    claims.issuedAt > now + 60 ||
    claims.expiresAt <= now ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt > CUT_CLUB_MAX_SESSION_SECONDS ||
    now - claims.issuedAt > CUT_CLUB_MAX_SESSION_SECONDS ||
    claims.verifiedAt > claims.issuedAt ||
    claims.issuedAt - claims.verifiedAt > 600
  ) return invalid();

  if (
    typeof expectedTenantId !== "string" ||
    expectedTenantId.trim().length === 0 ||
    claims.tenantId !== expectedTenantId
  ) return invalid();

  return {
    ok: true,
    subject: Object.freeze({
      customerId: claims.customerId,
      tenantId: claims.tenantId,
      sessionId: claims.sessionId,
      verificationMethod: "otp",
      verifiedAt: claims.verifiedAt,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
    }),
  };
}

/** A valid signed token must ALSO match the trusted resource owner + tenant. */
export function customerOwnsRecord(
  subject: VerifiedCustomerSubject,
  record: Readonly<{ tenantId: string; customerId: number }>,
): boolean {
  return positiveInt(record.customerId) &&
    subject.customerId === record.customerId &&
    subject.tenantId === record.tenantId &&
    record.tenantId.trim().length > 0;
}
