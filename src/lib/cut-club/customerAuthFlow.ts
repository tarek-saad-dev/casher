/**
 * CUT CLUB 2.0 — isolated provider-neutral customer OTP -> session flow.
 * This module has NO HTTP route, cookie writer, phone lookup or DB provider.
 * It is a trusted-server composition contract, NOT a live login endpoint.
 *
 * All dependencies MUST be independently approved and injected:
 * - tenant UUID resolved server-side (never from clientId or request body)
 * - staging-qualified transactional OTP repository and durable rate limiting
 * - approved transport with delivery controls (no logging of OTP codes)
 * - authoritative tenant-scoped customer lookup AFTER verified OTP consumption
 *
 * Never bypass binding for an ambiguous/shared/inactive number.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  bindVerifiedCustomer, digestVerifiedPhoneForOtp, prepareOpaqueSession,
  prepareOtpChallenge, stopOtpChallenge, verifyOpaqueSession,
  verifyOtpAfterAtomicCommit,
} from "./otpDomain";
import type {
  CustomerMatch, OpaqueSessionRecord, OtpDeliveryProvider, OtpDurableRepository,
} from "./otpDomain";

type TrustedAuthDeps = Readonly<{
  repository: OtpDurableRepository;
  provider: OtpDeliveryProvider;
  secret: string | undefined;
  /** Trusted server-only tenant UUID from authoritative branch/tenant source. */
  trustedTenantId: string;
}>;

type OtpSendResult =
  | Readonly<{ ok: true; challengeId: string }>
  | Readonly<{ ok: false; reason: "unavailable" }>;
type OtpLoginResult =
  | Readonly<{ ok: true; sessionTokenForTrustedCookieWriter: string; expiresAt: number }>
  | Readonly<{ ok: false; reason: "unavailable" }>;

const reject = (): OtpSendResult => ({ ok: false, reason: "unavailable" });
const rejectLogin = (): OtpLoginResult => ({ ok: false, reason: "unavailable" });
const validUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const validTime = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const validDigest = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{64}$/i.test(v);
const validChallengeId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z\d_-]{32}$/.test(v);
const validOpaqueToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z\d_-]{43}$/.test(v);

function shaSessionToken(token: string): string {
  return createHash("sha256")
    .update("cut-club-opaque-session-v1:").update(token).digest("hex");
}

/** Reserve in SQL BEFORE OTP delivery. Never return the generated code. */
export async function requestCutClubOtp(
  deps: TrustedAuthDeps,
  input: Readonly<{ phoneE164: string; trustedIpDigest: string; nowSeconds: number }>,
): Promise<OtpSendResult> {
  if (!validUuid(deps.trustedTenantId) || !validDigest(input.trustedIpDigest) ||
      !validTime(input.nowSeconds)) return reject();
  try {
    const prepared = prepareOtpChallenge({
      tenantId: deps.trustedTenantId, phoneE164: input.phoneE164,
      secret: deps.secret, nowSeconds: input.nowSeconds,
    });
    const stored = await deps.repository.reserveChallenge({
      challenge: prepared.challenge,
      ipDigest: input.trustedIpDigest,
      nowSeconds: input.nowSeconds,
    });
    if (stored !== "stored") return reject();
    let delivered: "sent" | "failed" = "failed";
    try {
      delivered = await deps.provider.sendCode({
        tenantId: deps.trustedTenantId,
        phoneE164: input.phoneE164,
        codeForDelivery: prepared.codeForDelivery,
        challengeId: prepared.challenge.id,
      });
    } catch {
      // Provider exceptions may never be sent to the client or logged with PII.
    }
    if (delivered !== "sent") {
      await deps.repository.commitAttempt({
        before: prepared.challenge,
        after: stopOtpChallenge(prepared.challenge, "delivery_failed"),
      }).catch(() => false);
      return reject();
    }
    return { ok: true, challengeId: prepared.challenge.id };
  } catch { return reject(); }
}

/**
 * After a successful, single-use CAS, bind the VERIFIED phone to exactly one
 * active customer in the authoritative tenant scope before creating a session.
 * The phone here must match the original OTP challenge's HMAC digest.
 */
export async function verifyCutClubOtpAndCreateSession(
  deps: TrustedAuthDeps,
  input: Readonly<{
    challengeId: string;
    phoneE164: string;
    code: unknown;
    nowSeconds: number;
    resolveCustomerByVerifiedPhone: (query: Readonly<{
      trustedTenantId: string; verifiedPhoneE164: string;
    }>) => Promise<readonly CustomerMatch[]>;
  }>,
): Promise<OtpLoginResult> {
  if (!validUuid(deps.trustedTenantId) || !validChallengeId(input.challengeId) ||
      !validTime(input.nowSeconds)) return rejectLogin();
  const expectedPhoneDigest = digestVerifiedPhoneForOtp({
    tenantId: deps.trustedTenantId,
    phoneE164: input.phoneE164,
    secret: deps.secret,
  });
  if (!expectedPhoneDigest) return rejectLogin();
  try {
    const challenge = await deps.repository.loadChallenge({
      tenantId: deps.trustedTenantId, challengeId: input.challengeId,
    });
    if (!challenge || challenge.tenantId !== deps.trustedTenantId ||
        challenge.id !== input.challengeId ||
        !validDigest(challenge.phoneDigest)) return rejectLogin();

    const expected = Buffer.from(expectedPhoneDigest, "hex");
    const actual = Buffer.from(challenge.phoneDigest, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return rejectLogin();

    // Requires SQL transactional CAS; correct code comparison alone is NEVER auth.
    const consumed = await verifyOtpAfterAtomicCommit({
      tenantId: deps.trustedTenantId,
      challengeId: input.challengeId,
      code: input.code,
      secret: deps.secret,
      nowSeconds: input.nowSeconds,
      repository: deps.repository,
    });
    if (!consumed) return rejectLogin();

    const matches = await input.resolveCustomerByVerifiedPhone({
      trustedTenantId: deps.trustedTenantId,
      verifiedPhoneE164: input.phoneE164,
    });
    const binding = bindVerifiedCustomer(matches, deps.trustedTenantId);
    if (!binding.ok) return rejectLogin();

    const material = prepareOpaqueSession({
      tenantId: binding.tenantId, customerId: binding.customerId,
      verifiedAtSeconds: input.nowSeconds, nowSeconds: input.nowSeconds,
    });
    if (await deps.repository.createSession(material.record) !== true) return rejectLogin();

    // Trusted BFF must set a host-only, Secure, HttpOnly, SameSite cookie,
    // enforce Origin/CSRF on mutating routes and never log/serialize the secret.
    return {
      ok: true,
      sessionTokenForTrustedCookieWriter: material.tokenForCookie,
      expiresAt: material.record.expiresAt,
    };
  } catch { return rejectLogin(); }
}

/** Used by a future trusted BFF only; never accepts a browser clientId. */
export async function resolveCutClubSession(
  repository: OtpDurableRepository,
  input: Readonly<{ trustedTenantId: string; opaqueCookieToken: unknown; nowSeconds: number }>,
): Promise<OpaqueSessionRecord | null> {
  if (!validUuid(input.trustedTenantId) || !validOpaqueToken(input.opaqueCookieToken) ||
      !validTime(input.nowSeconds)) return null;
  try {
    const record = await repository.getSession({
      tenantId: input.trustedTenantId, tokenDigest: shaSessionToken(input.opaqueCookieToken),
    });
    return verifyOpaqueSession(input.opaqueCookieToken, record, {
      tenantId: input.trustedTenantId, nowSeconds: input.nowSeconds,
    }) ? record : null;
  } catch { return null; }
}

/** Caller MUST expire browser cookie regardless of returned boolean. */
export async function revokeCutClubSession(
  repository: OtpDurableRepository,
  input: Readonly<{ trustedTenantId: string; opaqueCookieToken: unknown; nowSeconds: number }>,
): Promise<boolean> {
  if (!validUuid(input.trustedTenantId) || !validOpaqueToken(input.opaqueCookieToken) ||
      !validTime(input.nowSeconds)) return false;
  try {
    return await repository.revokeSession({
      tenantId: input.trustedTenantId,
      tokenDigest: shaSessionToken(input.opaqueCookieToken),
      nowSeconds: input.nowSeconds,
    });
  } catch { return false; }
}
