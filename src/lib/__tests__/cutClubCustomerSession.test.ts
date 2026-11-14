import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  customerOwnsRecord,
  CUT_CLUB_AUDIENCE,
  CUT_CLUB_ISSUER,
  verifyCutClubCustomerSession,
} from "@/lib/cut-club/customerSession";

const secret = "test-only-cut-club-signing-secret-not-for-deployment-2026";
const now = 1900000000;
const claims = {
  version: 1,
  audience: CUT_CLUB_AUDIENCE,
  issuer: CUT_CLUB_ISSUER,
  customerId: 101,
  tenantId: "salon-tenant-A",
  sessionId: "test_session_10000001",
  verificationMethod: "otp",
  verifiedAt: now - 120,
  issuedAt: now - 60,
  expiresAt: now + 1200,
};

function sign(data: Record<string, unknown> = claims, key = secret): string {
  const body = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return body + "." + signature;
}
const verify = (token: unknown, tenant?: string, key: string | undefined = secret) =>
  verifyCutClubCustomerSession(token, { secret: key, expectedTenantId: tenant, nowSeconds: now });

describe("CUT CLUB verified customer session foundation", () => {
  it("validates customer-only OTP subject with signed tenant and owner", () => {
    const result = verify(sign(), "salon-tenant-A");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected verified test fixture");
    expect(result.subject.customerId).toBe(101);
    expect(result.subject.tenantId).toBe("salon-tenant-A");
    expect(result.subject.verificationMethod).toBe("otp");
    expect(Object.isFrozen(result.subject)).toBe(true);
  });

  it("refuses missing, short or unconfigured secrets", () => {
    expect(verify(sign(), undefined, undefined)).toEqual({ ok: false, reason: "misconfigured" });
    expect(verify(sign(), undefined, "short")).toEqual({ ok: false, reason: "misconfigured" });
  });

  it("fails closed on tokens missing a valid signature", () => {
    for (const value of [undefined, null, "", "clientId=101", "101", "a.b.c", "x".repeat(5000)]) {
      expect(verify(value).ok).toBe(false);
    }
  });

  it("refuses altered signatures, swapped subject, and wrong signing keys", () => {
    const token = sign();
    const modified = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verify(modified).ok).toBe(false);
    expect(verify(sign({ ...claims, customerId: 102 }), undefined, secret + "-wrong").ok).toBe(false);
  });

  it("rejects expired, not-yet-issued, too-long and stale OTP issuance", () => {
    for (const data of [
      { ...claims, expiresAt: now },
      { ...claims, issuedAt: now + 120 },
      { ...claims, expiresAt: now + 24 * 60 * 60 },
      { ...claims, verifiedAt: now + 1 },
      { ...claims, verifiedAt: now - 24 * 60 * 60 },
    ]) expect(verify(sign(data)).ok).toBe(false);
  });

  it("rejects staff sessions and tokens for other audiences", () => {
    const staff = { ...claims, audience: "pos_session", issuer: "pos-staff", verificationMethod: "password" };
    expect(verify(sign(staff)).ok).toBe(false);
    expect(verify(sign({ ...claims, audience: "other-tenant-app" })).ok).toBe(false);
    expect(verify(sign({ ...claims, verificationMethod: "phone-lookup" })).ok).toBe(false);
  });

  it("refuses cross-tenant and empty tenant scopes", () => {
    expect(verify(sign(), "salon-tenant-B").ok).toBe(false);
    expect(verify(sign(), "").ok).toBe(false);
  });

  it("requires resource-level customer and tenant ownership after token validation", () => {
    const result = verify(sign(), "salon-tenant-A");
    if (!result.ok) throw new Error("expected authenticated fixture");
    expect(customerOwnsRecord(result.subject, { customerId: 101, tenantId: "salon-tenant-A" })).toBe(true);
    expect(customerOwnsRecord(result.subject, { customerId: 102, tenantId: "salon-tenant-A" })).toBe(false);
    expect(customerOwnsRecord(result.subject, { customerId: 101, tenantId: "salon-tenant-B" })).toBe(false);
    expect(customerOwnsRecord(result.subject, { customerId: 0, tenantId: "salon-tenant-A" })).toBe(false);
  });
});
