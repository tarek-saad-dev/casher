import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  requestCutClubOtp, resolveCutClubSession, revokeCutClubSession,
  verifyCutClubOtpAndCreateSession,
} from "@/lib/cut-club/customerAuthFlow";
import type {
  CustomerMatch, OpaqueSessionRecord, OtpChallenge,
  OtpDeliveryProvider, OtpDurableRepository,
} from "@/lib/cut-club/otpDomain";
import { verifyOpaqueSession } from "@/lib/cut-club/otpDomain";

const tenantId = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const otherTenant = "e1413a3e-dc87-4a70-bc6e-d00d76f9066b";
const phoneE164 = "+201001234567";
const now = 1_900_000_000;
const secret = "unit-test-auth-flow-secret-at-least-32-characters";
const ipDigest = "c2".repeat(32);
const member: CustomerMatch = { tenantId, customerId: 42, active: true };

class FakeDurableRepo implements OtpDurableRepository {
  challenge: OtpChallenge | null = null;
  sessions = new Map<string, OpaqueSessionRecord>();
  attempts = 0;
  reservations = 0;
  forcedRateLimit = false;
  forcedCommitFailure = false;
  forcedSessionFailure = false;
  async reserveChallenge({ challenge }: { challenge: OtpChallenge; ipDigest: string; nowSeconds: number }) {
    if (this.forcedRateLimit) return "rate_limited" as const;
    this.reservations++;
    this.challenge = challenge;
    return "stored" as const;
  }
  async loadChallenge({ tenantId: t, challengeId }: { tenantId: string; challengeId: string }) {
    return this.challenge?.tenantId === t && this.challenge.id === challengeId ? this.challenge : null;
  }
  async commitAttempt({ before, after }: { before: OtpChallenge; after: OtpChallenge }) {
    if (this.forcedCommitFailure || this.challenge?.id !== before.id ||
        this.challenge?.status !== "pending" ||
        this.challenge.revision !== before.revision ||
        this.challenge.tenantId !== before.tenantId) return false;
    this.attempts++;
    this.challenge = after;
    return true;
  }
  async createSession(record: OpaqueSessionRecord) {
    if (this.forcedSessionFailure) return false;
    this.sessions.set(record.tokenDigest, record);
    return true;
  }
  async getSession({ tenantId: t, tokenDigest }: { tenantId: string; tokenDigest: string }) {
    const r = this.sessions.get(tokenDigest);
    return r?.tenantId === t ? r : null;
  }
  async revokeSession({ tenantId: t, tokenDigest, nowSeconds }: { tenantId: string; tokenDigest: string; nowSeconds: number }) {
    const r = this.sessions.get(tokenDigest);
    if (!r || r.tenantId !== t || r.revokedAt !== null) return false;
    this.sessions.set(tokenDigest, { ...r, revokedAt: nowSeconds });
    return true;
  }
}

function setup() {
  const repo = new FakeDurableRepo();
  let sentCode: string | null = null;
  let sends = 0;
  let failDelivery = false;
  const provider: OtpDeliveryProvider = {
    async sendCode(input) {
      sends++;
      if (failDelivery) throw Error("private-transport-error");
      sentCode = input.codeForDelivery;
      return "sent";
    },
  };
  return {
    repo, provider,
    deps: { trustedTenantId: tenantId, secret, repository: repo, provider },
    getCode: () => sentCode,
    getSends: () => sends,
    fail: () => { failDelivery = true; },
  };
}

describe("CUT CLUB complete OTP orchestration contract — synthetic no DB, no transport", () => {
  it("delivers only AFTER persistent reservation; never exposes generated OTP to caller", async () => {
    const o = setup();
    const result = await requestCutClubOtp(o.deps, {
      phoneE164, trustedIpDigest: ipDigest, nowSeconds: now,
    });
    expect(result.ok).toBe(true);
    expect(o.repo.reservations).toBe(1);
    expect(o.getSends()).toBe(1);
    expect(result).toHaveProperty("challengeId");
    expect(JSON.stringify(result)).not.toContain(o.getCode());
    expect(result).not.toHaveProperty("codeForDelivery");
  });

  it("requires SAME originally challenged phone + atomic OTP consume BEFORE tenant/customer binding", async () => {
    const o = setup();
    const issued = await requestCutClubOtp(o.deps, { phoneE164, trustedIpDigest: ipDigest, nowSeconds: now });
    if (!issued.ok) throw Error("fake reservation failed");
    let lookups = 0;
    const resolver = async () => {
      lookups++;
      return [member];
    };
    const basic = { challengeId: issued.challengeId, code: o.getCode(), nowSeconds: now + 1,
      resolveCustomerByVerifiedPhone: resolver };
    expect(await verifyCutClubOtpAndCreateSession(o.deps, { ...basic, phoneE164: "+201001234568" }))
      .toEqual({ ok: false, reason: "unavailable" });
    expect(lookups).toBe(0);
    expect(o.repo.attempts).toBe(0);

    expect(await verifyCutClubOtpAndCreateSession(o.deps, { ...basic, phoneE164, code: "123" }))
      .toEqual({ ok: false, reason: "unavailable" });
    expect(lookups).toBe(0);
    expect(o.repo.attempts).toBe(1);

    const signedIn = await verifyCutClubOtpAndCreateSession(o.deps, { ...basic, phoneE164 });
    expect(signedIn.ok).toBe(true);
    if (!signedIn.ok) throw Error("fake login failed");
    expect(lookups).toBe(1);
    expect(signedIn.sessionTokenForTrustedCookieWriter).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(o.repo.sessions.size).toBe(1);
    expect(JSON.stringify([...o.repo.sessions.values()])).not.toContain(signedIn.sessionTokenForTrustedCookieWriter);
    expect(await verifyCutClubOtpAndCreateSession(o.deps, { ...basic, phoneE164 }))
      .toEqual({ ok: false, reason: "unavailable" });
    expect(o.repo.sessions.size).toBe(1);

    const session = await resolveCutClubSession(o.repo, {
      trustedTenantId: tenantId, opaqueCookieToken: signedIn.sessionTokenForTrustedCookieWriter,
      nowSeconds: now + 10,
    });
    expect(session?.customerId).toBe(42);
    expect(verifyOpaqueSession(signedIn.sessionTokenForTrustedCookieWriter, session,
      { tenantId, nowSeconds: now + 10 })).toBe(true);
    expect(await resolveCutClubSession(o.repo, {
      trustedTenantId: otherTenant, opaqueCookieToken: signedIn.sessionTokenForTrustedCookieWriter,
      nowSeconds: now + 10,
    })).toBeNull();
    expect(await revokeCutClubSession(o.repo, {
      trustedTenantId: tenantId, opaqueCookieToken: signedIn.sessionTokenForTrustedCookieWriter,
      nowSeconds: now + 20,
    })).toBe(true);
    expect(await resolveCutClubSession(o.repo, {
      trustedTenantId: tenantId, opaqueCookieToken: signedIn.sessionTokenForTrustedCookieWriter,
      nowSeconds: now + 21,
    })).toBeNull();
  });

  it("rejects ambiguous/shared and cross-tenant binding even after correct OTP", async () => {
    for (const results of [
      [], [{ ...member, active: false }],
      [member, { ...member, customerId: 43 }],
      [{ ...member, tenantId: otherTenant }],
    ]) {
      const o = setup();
      const issued = await requestCutClubOtp(o.deps, { phoneE164, trustedIpDigest: ipDigest, nowSeconds: now });
      if (!issued.ok) throw Error("setup issue");
      const output = await verifyCutClubOtpAndCreateSession(o.deps, {
        challengeId: issued.challengeId, phoneE164, code: o.getCode(),
        nowSeconds: now + 1,
        resolveCustomerByVerifiedPhone: async () => results,
      });
      expect(output).toEqual({ ok: false, reason: "unavailable" });
      expect(o.repo.sessions.size).toBe(0);
    }
  });

  it("never delivers when rate-limited and makes failed-delivery challenge unusable", async () => {
    const o = setup();
    o.repo.forcedRateLimit = true;
    expect(await requestCutClubOtp(o.deps, {
      phoneE164, trustedIpDigest: ipDigest, nowSeconds: now,
    })).toEqual({ ok: false, reason: "unavailable" });
    expect(o.getSends()).toBe(0);
    o.repo.forcedRateLimit = false;
    o.fail();
    expect(await requestCutClubOtp(o.deps, {
      phoneE164, trustedIpDigest: ipDigest, nowSeconds: now,
    })).toEqual({ ok: false, reason: "unavailable" });
    expect(o.repo.challenge?.status).toBe("delivery_failed");
  });

  it("does not issue a session if the atomic consume or durable session insert fails", async () => {
    for (const fail of ["cas", "session"]) {
      const o = setup();
      const issued = await requestCutClubOtp(o.deps, { phoneE164, trustedIpDigest: ipDigest, nowSeconds: now });
      if (!issued.ok) throw Error("setup issue");
      if (fail === "cas") o.repo.forcedCommitFailure = true;
      else o.repo.forcedSessionFailure = true;
      const outcome = await verifyCutClubOtpAndCreateSession(o.deps, {
        challengeId: issued.challengeId, phoneE164, code: o.getCode(),
        nowSeconds: now + 1,
        resolveCustomerByVerifiedPhone: async () => [member],
      });
      expect(outcome.ok).toBe(false);
      expect(o.repo.sessions.size).toBe(0);
    }
  });

  it("rejects invalid tenant, arbitrary tokens, expired sessions, and phone-only auth", async () => {
    const o = setup();
    const badTenant = { ...o.deps, trustedTenantId: "cut-salon" };
    expect(await requestCutClubOtp(badTenant, {
      phoneE164, trustedIpDigest: ipDigest, nowSeconds: now,
    })).toEqual({ ok: false, reason: "unavailable" });
    expect(await resolveCutClubSession(o.repo, {
      trustedTenantId: tenantId, opaqueCookieToken: "clientId=42", nowSeconds: now,
    })).toBeNull();
    expect(await revokeCutClubSession(o.repo, {
      trustedTenantId: tenantId, opaqueCookieToken: "clientId=42", nowSeconds: now,
    })).toBe(false);
    expect(o.repo.reservations).toBe(0);
  });

  it("is not a live HTTP route and has no mssql, cookies, clientId, localStorage or real provider", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/cut-club/customerAuthFlow.ts"), "utf8");
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const unsafe of [
      "getPool(", "NextResponse", "NextRequest", "cookies(", "localStorage",
      "clientId", "req.json(", "new ConnectionPool", "console.log(",
    ]) expect(executable).not.toContain(unsafe);
    expect(source).toContain("verifyOtpAfterAtomicCommit");
    expect(source).toContain("bindVerifiedCustomer");
  });
});
