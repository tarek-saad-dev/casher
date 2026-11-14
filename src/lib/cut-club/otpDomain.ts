/**
 * CUT CLUB verified-phone auth domain (Issue #255).
 *
 * Pure, Node-only building blocks. NOT a login API, NOT an OTP sender and
 * NOT a session issuer endpoint. A durable transactional repository, verified
 * delivery provider and authoritative account binding MUST be implemented
 * before any route is allowed to use these helpers.
 *
 * Never mint a customer session from caller-supplied clientId / phone lookup.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_VALID_FOR_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_VALID_FOR_SECONDS = 2 * 60 * 60;

export type OtpStatus = "pending" | "consumed" | "locked" | "expired" | "replaced" | "delivery_failed";

export type OtpChallenge = Readonly<{
  id: string;
  tenantId: string;
  phoneDigest: string;
  codeDigest: string;
  attempts: number;
  status: OtpStatus;
  createdAt: number;
  expiresAt: number;
  revision: number;
}>;

export type IssuedOtp = Readonly<{
  /** Secret: deliver only through an approved OTP delivery provider. NEVER log or return to the browser. */
  codeForDelivery: string;
  challenge: OtpChallenge;
}>;

export type OtpVerification =
  | { ok: true; updated: OtpChallenge }
  | { ok: false; updated: OtpChallenge; reason: "invalid" | "expired" | "locked" };

export type CustomerMatch = Readonly<{ customerId: number; tenantId: string; active: boolean }>;

export type CustomerBinding =
  | { ok: true; customerId: number; tenantId: string }
  | { ok: false; reason: "not_found" | "ambiguous" | "inactive" | "invalid_scope" };

export type OpaqueSessionRecord = Readonly<{
  tokenDigest: string;
  tenantId: string;
  customerId: number;
  verifiedAt: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}>;

export type OpaqueSessionMaterial = Readonly<{
  /** Only the trusted server sets this in a Secure, HttpOnly, host-only cookie. */
  tokenForCookie: string;
  record: OpaqueSessionRecord;
}>;

const validInt = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;

const validTenant = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= 128 &&
  x.trim() === x && /^[a-zA-Z0-9_-]+$/.test(x);

const validPepper = (secret: unknown): secret is string =>
  typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;

const validPhone = (p: unknown): p is string =>
  typeof p === "string" && /^\+[1-9][0-9]{7,14}$/.test(p);

function keyedDigest(secret: string, purpose: string, parts: readonly string[]): string {
  return createHmac("sha256", secret).update(JSON.stringify([purpose, ...parts])).digest("hex");
}

function opaqueDigest(token: string): string {
  return createHash("sha256").update("cut-club-opaque-session-v1:").update(token).digest("hex");
}

/**
 * Prepare an OTP for delivery. The caller must FIRST obtain a durable
 * atomic issuance/rate-limit reservation and persist this challenge BEFORE
 * sending the code. It must mark failed deliveries as delivery_failed.
 * This helper does not consult a database or enforce rate limiting.
 */
export function prepareOtpChallenge(input: Readonly<{
  tenantId: string;
  phoneE164: string;
  secret: string | undefined;
  nowSeconds: number;
}>): IssuedOtp {
  if (!validTenant(input.tenantId) || !validPhone(input.phoneE164) ||
      !validPepper(input.secret) || !validInt(input.nowSeconds)) {
    throw new Error("CUT_CLUB_OTP_UNAVAILABLE");
  }

  const id = randomBytes(24).toString("base64url");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return {
    codeForDelivery: code,
    challenge: Object.freeze({
      id,
      tenantId: input.tenantId,
      phoneDigest: keyedDigest(input.secret, "phone", [input.tenantId, input.phoneE164]),
      codeDigest: keyedDigest(input.secret, "otp", [input.tenantId, id, code]),
      attempts: 0,
      status: "pending" as const,
      createdAt: input.nowSeconds,
      expiresAt: input.nowSeconds + OTP_VALID_FOR_SECONDS,
      revision: 0,
    }),
  };
}

/**
 * Calculate one attempt transition. A durable adapter MUST commit the result
 * with compare-and-swap on (challenge.id, challenge.revision, status=pending),
 * then return success ONLY if that atomic update committed.
 * Returning this function's ok:true without atomic consume is UNSAFE.
 */
export function checkOtpAttempt(
  record: OtpChallenge,
  code: unknown,
  input: Readonly<{
    tenantId: string;
    secret: string | undefined;
    nowSeconds: number;
  }>,
): OtpVerification {
  const unchanged = { ok: false, updated: record, reason: "invalid" as const };

  if (!validTenant(input.tenantId) || !validPepper(input.secret) ||
      !validInt(input.nowSeconds) || input.tenantId !== record.tenantId ||
      record.revision < 0 || !Number.isSafeInteger(record.revision)) return unchanged;

  if (record.status !== "pending") {
    return { ok: false, updated: record, reason: record.status === "locked" ? "locked" : "invalid" };
  }

  if (record.expiresAt <= input.nowSeconds ||
      record.expiresAt - record.createdAt > OTP_VALID_FOR_SECONDS) {
    return { ok: false, reason: "expired", updated: { ...record, status: "expired", revision: record.revision + 1 } };
  }

  if (!Number.isSafeInteger(record.attempts) || record.attempts < 0 ||
      record.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "locked", updated: { ...record, status: "locked", revision: record.revision + 1 } };
  }

  // Count an invalid input as a failed attempt. Only a six-digit code is valid.
  const validCode = typeof code === "string" && /^[0-9]{6}$/.test(code);
  let match = false;
  if (validCode) {
    const expected = Buffer.from(record.codeDigest, "hex");
    const actual = Buffer.from(keyedDigest(input.secret, "otp", [record.tenantId, record.id, code]), "hex");
    match = expected.length === 32 && actual.length === expected.length &&
      timingSafeEqual(expected, actual);
  }

  if (match) {
    return { ok: true, updated: { ...record, status: "consumed", revision: record.revision + 1 } };
  }

  const attempts = record.attempts + 1;
  return {
    ok: false,
    reason: attempts >= OTP_MAX_ATTEMPTS ? "locked" : "invalid",
    updated: {
      ...record,
      attempts,
      status: attempts >= OTP_MAX_ATTEMPTS ? "locked" : "pending",
      revision: record.revision + 1,
    },
  };
}

/** Used only by a durable store after replacement or failed delivery. */
export function stopOtpChallenge(
  record: OtpChallenge,
  status: "replaced" | "delivery_failed",
): OtpChallenge {
  if (record.status !== "pending") return record;
  return { ...record, status, revision: record.revision + 1 };
}

/**
 * Result of an AUTHORITY-TRUSTED database query scoped by the VERIFIED phone
 * and tenant (after successful, atomically committed OTP consumption).
 * Never derive matches from public request clientId/body.
 */
export function bindVerifiedCustomer(
  matches: readonly CustomerMatch[],
  tenantId: string,
): CustomerBinding {
  if (!validTenant(tenantId) || !Array.isArray(matches)) {
    return { ok: false, reason: "invalid_scope" };
  }
  if (matches.some(m => !validInt(m.customerId) || m.tenantId !== tenantId)) {
    return { ok: false, reason: "invalid_scope" };
  }
  if (matches.length === 0) return { ok: false, reason: "not_found" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };
  if (!matches[0].active) return { ok: false, reason: "inactive" };
  return { ok: true, tenantId, customerId: matches[0].customerId };
}

/**
 * Generate a random opaque session secret + hash-only storage row.
 * MUST be invoked only after atomic OTP consume + authoritative binding.
 * No HTTP/cookie route is implemented in this sprint.
 */
export function prepareOpaqueSession(input: Readonly<{
  tenantId: string;
  customerId: number;
  verifiedAtSeconds: number;
  nowSeconds: number;
}>): OpaqueSessionMaterial {
  if (!validTenant(input.tenantId) || !validInt(input.customerId) ||
      !validInt(input.verifiedAtSeconds) || !validInt(input.nowSeconds) ||
      input.verifiedAtSeconds > input.nowSeconds ||
      input.nowSeconds - input.verifiedAtSeconds > OTP_VALID_FOR_SECONDS) {
    throw new Error("CUT_CLUB_SESSION_UNAVAILABLE");
  }

  const tokenForCookie = randomBytes(32).toString("base64url");
  return {
    tokenForCookie,
    record: Object.freeze({
      tokenDigest: opaqueDigest(tokenForCookie),
      tenantId: input.tenantId,
      customerId: input.customerId,
      verifiedAt: input.verifiedAtSeconds,
      createdAt: input.nowSeconds,
      expiresAt: input.nowSeconds + SESSION_VALID_FOR_SECONDS,
      revokedAt: null,
    }),
  };
}

/** Compare against an authoritative stored record with fail-closed semantics. */
export function verifyOpaqueSession(
  token: unknown,
  record: OpaqueSessionRecord | null | undefined,
  input: Readonly<{ tenantId: string; nowSeconds: number }>,
): boolean {
  if (!record || !validTenant(input.tenantId) || !validInt(input.nowSeconds) ||
      record.tenantId !== input.tenantId || !validInt(record.customerId) ||
      record.revokedAt !== null || record.expiresAt <= input.nowSeconds ||
      record.expiresAt <= record.createdAt ||
      record.expiresAt - record.createdAt > SESSION_VALID_FOR_SECONDS ||
      typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;

  const actual = Buffer.from(opaqueDigest(token), "hex");
  const expected = Buffer.from(record.tokenDigest, "hex");
  return actual.length === 32 && expected.length === actual.length &&
    timingSafeEqual(actual, expected);
}

export function revokeOpaqueSession(record: OpaqueSessionRecord, nowSeconds: number): OpaqueSessionRecord {
  if (!validInt(nowSeconds) || record.revokedAt !== null) return record;
  return { ...record, revokedAt: nowSeconds };
}
