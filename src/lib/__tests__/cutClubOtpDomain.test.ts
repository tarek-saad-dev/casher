import { describe, expect, it } from "vitest";
import {
  bindVerifiedCustomer,
  checkOtpAttempt,
  OTP_MAX_ATTEMPTS,
  OTP_VALID_FOR_SECONDS,
  prepareOpaqueSession,
  prepareOtpChallenge,
  revokeOpaqueSession,
  SESSION_VALID_FOR_SECONDS,
  stopOtpChallenge,
  verifyOpaqueSession,
  verifyOtpAfterAtomicCommit,
  type OtpChallenge,
  type OtpDurableRepository,
} from "@/lib/cut-club/otpDomain";

const now = 1_900_000_000;
const pepper = "test-only-private-pepper-with-at-least-thirty-two-characters";
const tenantId = "cut-salon";
const phoneE164 = "+201001234567";

const prepare = () => prepareOtpChallenge({ tenantId, phoneE164, secret: pepper, nowSeconds: now });
const check = (record: OtpChallenge, code: unknown, t = tenantId, at = now + 1, key = pepper) =>
  checkOtpAttempt(record, code, { tenantId: t, nowSeconds: at, secret: key });

describe("CUT CLUB provider-neutral OTP preparation (offline only)", () => {
  it("generates a six-digit code and unpredictable challenge identifier", () => {
    const a = prepare();
    const b = prepare();
    expect(a.codeForDelivery).toMatch(/^[0-9]{6}$/);
    expect(a.challenge.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.challenge.id).not.toBe(b.challenge.id);
    expect(a.challenge.codeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(a.challenge.codeDigest).not.toContain(a.codeForDelivery);
    expect(a.challenge.phoneDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(a.challenge.phoneDigest).not.toContain(phoneE164);
    expect(a.challenge.expiresAt - a.challenge.createdAt).toBe(OTP_VALID_FOR_SECONDS);
    expect(a.challenge.status).toBe("pending");
  });

  it("refuses unsafe issuer context, phone, time and pepper", () => {
    for (const change of [
      { tenantId: "", phoneE164, secret: pepper, nowSeconds: now },
      { tenantId, phoneE164: "01001234567", secret: pepper, nowSeconds: now },
      { tenantId, phoneE164, secret: "unsafe", nowSeconds: now },
      { tenantId, phoneE164, secret: undefined, nowSeconds: now },
      { tenantId, phoneE164, secret: pepper, nowSeconds: -1 },
    ]) {
      expect(() => prepareOtpChallenge(change)).toThrow("CUT_CLUB_OTP_UNAVAILABLE");
    }
  });

  it("supports one successful verification only, conditional on atomic database consume", () => {
    const { codeForDelivery, challenge } = prepare();
    const good = check(challenge, codeForDelivery);
    expect(good.ok).toBe(true);
    expect(good.updated.status).toBe("consumed");
    expect(good.updated.revision).toBe(1);
    const replay = check(good.updated, codeForDelivery);
    expect(replay.ok).toBe(false);
  });

  it("counts wrong attempts and locks at exactly five failures", () => {
    const { challenge } = prepare();
    let current = challenge;
    for (let n = 1; n <= OTP_MAX_ATTEMPTS; n++) {
      const result = check(current, "nope");
      expect(result.ok).toBe(false);
      current = result.updated;
      expect(current.attempts).toBe(n);
      expect(current.revision).toBe(n);
      expect(current.status).toBe(n === OTP_MAX_ATTEMPTS ? "locked" : "pending");
    }
    expect(check(current, "123456").ok).toBe(false);
    expect(check(current, "123456").updated.attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it("expires at five minutes and refuses secret/tenant mismatches", () => {
    const { codeForDelivery, challenge } = prepare();
    const expired = check(challenge, codeForDelivery, tenantId, now + OTP_VALID_FOR_SECONDS);
    expect(expired).toMatchObject({ ok: false, reason: "expired" });
    expect(expired.updated.status).toBe("expired");
    expect(check(challenge, codeForDelivery, "another-tenant").ok).toBe(false);
    expect(check(challenge, codeForDelivery, tenantId, now + 1, pepper + "-wrong").ok).toBe(false);
  });

  it("refuses replaced and failed-delivery challenges", () => {
    const { codeForDelivery, challenge } = prepare();
    const replaced = stopOtpChallenge(challenge, "replaced");
    const deliveryFailed = stopOtpChallenge(challenge, "delivery_failed");
    expect(check(replaced, codeForDelivery).ok).toBe(false);
    expect(check(deliveryFailed, codeForDelivery).ok).toBe(false);
    expect(stopOtpChallenge(replaced, "delivery_failed")).toEqual(replaced);
  });

  it("rejects corrupted challenge revisions/attempt counters", () => {
    const { codeForDelivery, challenge } = prepare();
    expect(check({ ...challenge, revision: -1 }, codeForDelivery).ok).toBe(false);
    expect(check({ ...challenge, attempts: -1 }, codeForDelivery).ok).toBe(false);
    expect(check({ ...challenge, attempts: OTP_MAX_ATTEMPTS }, codeForDelivery).ok).toBe(false);
  });
});

describe("CUT CLUB account binding (requires authoritative verified-phone query)", () => {
  it("binds only one trusted active tenant-scoped customer", () => {
    expect(bindVerifiedCustomer([{ customerId: 12, tenantId, active: true }], tenantId))
      .toEqual({ ok: true, customerId: 12, tenantId });
  });
  it("refuses missing, shared-phone/duplicate, inactive and cross-tenant accounts", () => {
    expect(bindVerifiedCustomer([], tenantId)).toMatchObject({ ok: false, reason: "not_found" });
    expect(bindVerifiedCustomer([
      { customerId: 12, tenantId, active: true },
      { customerId: 13, tenantId, active: true },
    ], tenantId)).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(bindVerifiedCustomer([{ customerId: 12, tenantId, active: false }], tenantId))
      .toMatchObject({ ok: false, reason: "inactive" });
    expect(bindVerifiedCustomer([{ customerId: 12, tenantId: "other-tenant", active: true }], tenantId))
      .toMatchObject({ ok: false, reason: "invalid_scope" });
    expect(bindVerifiedCustomer([{ customerId: 0, tenantId, active: true }], tenantId))
      .toMatchObject({ ok: false, reason: "invalid_scope" });
  });
});

describe("CUT CLUB opaque session material, verification and revocation", () => {
  const newSession = () => prepareOpaqueSession({
    tenantId, customerId: 12, verifiedAtSeconds: now - 10, nowSeconds: now,
  });

  it("produces 256-bit opaque token, stores digest only, and scopes TTL", () => {
    const session = newSession();
    expect(session.tokenForCookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.record.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(session.record.tokenDigest).not.toBe(session.tokenForCookie);
    expect(session.record.expiresAt - session.record.createdAt).toBe(SESSION_VALID_FOR_SECONDS);
    expect(verifyOpaqueSession(session.tokenForCookie, session.record, { tenantId, nowSeconds: now + 1 }))
      .toBe(true);
    expect(newSession().tokenForCookie).not.toBe(session.tokenForCookie);
  });

  it("refuses absent, modified, foreign-tenant or expired tokens", () => {
    const session = newSession();
    const options = { tenantId, nowSeconds: now + 1 };
    expect(verifyOpaqueSession(undefined, session.record, options)).toBe(false);
    expect(verifyOpaqueSession(session.tokenForCookie, null, options)).toBe(false);
    expect(verifyOpaqueSession(session.tokenForCookie + "X", session.record, options)).toBe(false);
    expect(verifyOpaqueSession(session.tokenForCookie, session.record, { ...options, tenantId: "other-tenant" })).toBe(false);
    expect(verifyOpaqueSession(session.tokenForCookie, session.record, { tenantId, nowSeconds: session.record.expiresAt })).toBe(false);
  });

  it("refuses revoked sessions, repeated revocation, and counterfeit rows", () => {
    const session = newSession();
    const revoked = revokeOpaqueSession(session.record, now + 25);
    expect(revoked.revokedAt).toBe(now + 25);
    expect(revokeOpaqueSession(revoked, now + 30)).toEqual(revoked);
    expect(verifyOpaqueSession(session.tokenForCookie, revoked, { tenantId, nowSeconds: now + 26 })).toBe(false);
    expect(verifyOpaqueSession(session.tokenForCookie, { ...session.record, tokenDigest: "A".repeat(64) }, { tenantId, nowSeconds: now + 1 })).toBe(false);
  });

  it("refuses unverified or stale OTP evidence before generating a session", () => {
    expect(() => prepareOpaqueSession({ tenantId, customerId: 12, verifiedAtSeconds: now + 1, nowSeconds: now }))
      .toThrow("CUT_CLUB_SESSION_UNAVAILABLE");
    expect(() => prepareOpaqueSession({ tenantId, customerId: 12, verifiedAtSeconds: now - 900, nowSeconds: now }))
      .toThrow("CUT_CLUB_SESSION_UNAVAILABLE");
    expect(() => prepareOpaqueSession({ tenantId, customerId: 0, verifiedAtSeconds: now - 1, nowSeconds: now }))
      .toThrow("CUT_CLUB_SESSION_UNAVAILABLE");
  });
});


describe("CUT CLUB atomic verification adapter contract (no database)", () => {
  /**
   * Fake implementation of a database CAS transaction:
   * only a pending, unmodified version under the same tenant can transition.
   * The real SQL Server adapter is NOT implemented or proved by these tests.
   */
  function fakeRepository(first: OtpChallenge) {
    let stored = first;
    const repository: Pick<OtpDurableRepository, "loadChallenge" | "commitAttempt"> = {
      async loadChallenge({ tenantId, challengeId }) {
        return stored.tenantId === tenantId && stored.id === challengeId ? stored : null;
      },
      async commitAttempt({ before, after }) {
        await Promise.resolve();
        if (
          before.id !== stored.id || before.tenantId !== stored.tenantId ||
          stored.status !== "pending" || stored.revision !== before.revision ||
          after.revision !== before.revision + 1 || after.tenantId !== before.tenantId ||
          after.id !== before.id
        ) return false;
        stored = after;
        return true;
      },
    };
    return { repository, getStored: () => stored };
  }

  it("accepts exactly one of two simultaneous correct OTP attempts", async () => {
    const { challenge, codeForDelivery } = prepare();
    const store = fakeRepository(challenge);
    const args = {
      tenantId, challengeId: challenge.id, code: codeForDelivery,
      secret: pepper, nowSeconds: now + 1, repository: store.repository,
    };
    const results = await Promise.all([
      verifyOtpAfterAtomicCommit(args),
      verifyOtpAfterAtomicCommit(args),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(store.getStored().status).toBe("consumed");
    expect(store.getStored().revision).toBe(1);
    expect(await verifyOtpAfterAtomicCommit(args)).toBe(false);
  });

  it("does not turn successful code comparison into authentication if CAS fails", async () => {
    const { challenge, codeForDelivery } = prepare();
    const repository: Pick<OtpDurableRepository, "loadChallenge" | "commitAttempt"> = {
      async loadChallenge() { return challenge; },
      async commitAttempt() { return false; },
    };
    expect(await verifyOtpAfterAtomicCommit({
      tenantId, challengeId: challenge.id, code: codeForDelivery,
      secret: pepper, nowSeconds: now + 1, repository,
    })).toBe(false);
  });

  it("fails closed when repository throws, cross-tenant challenge leaks or secret is absent", async () => {
    const { challenge, codeForDelivery } = prepare();
    const a = fakeRepository(challenge);
    const kwargs = {
      tenantId, challengeId: challenge.id, code: codeForDelivery,
      secret: pepper, nowSeconds: now + 1,
    };
    expect(await verifyOtpAfterAtomicCommit({
      ...kwargs, tenantId: "different-tenant", repository: a.repository,
    })).toBe(false);
    expect(await verifyOtpAfterAtomicCommit({
      ...kwargs, secret: undefined, repository: a.repository,
    })).toBe(false);
    const brokenRepository: Pick<OtpDurableRepository, "loadChallenge" | "commitAttempt"> = {
      async loadChallenge() { throw new Error("database unavailable"); },
      async commitAttempt() { return true; },
    };
    expect(await verifyOtpAfterAtomicCommit({
      ...kwargs, repository: brokenRepository,
    })).toBe(false);
    expect(a.getStored().status).toBe("pending");
  });

  it("wrong OTP updates attempt state without granting a session", async () => {
    const { challenge } = prepare();
    const store = fakeRepository(challenge);
    const ok = await verifyOtpAfterAtomicCommit({
      tenantId, challengeId: challenge.id, code: "not-a-code",
      secret: pepper, nowSeconds: now + 1, repository: store.repository,
    });
    expect(ok).toBe(false);
    expect(store.getStored().attempts).toBe(1);
    expect(store.getStored().status).toBe("pending");
  });
});
