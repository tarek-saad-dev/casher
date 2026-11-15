import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareOtpChallenge, prepareOpaqueSession, verifyOtpAfterAtomicCommit } from "@/lib/cut-club/otpDomain";
import { createStagingCutClubOtpRepository } from "@/lib/cut-club/sqlOtpRepository";
import type { CutClubStagingSqlPort, SqlField, SqlResult } from "@/lib/cut-club/sqlOtpRepository";

const tenantId = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const otherTenant = "e1413a3e-dc87-4a70-bc6e-d00d76f9066b";
const now = 1_900_000_000;
const secret = "unit-test-hmac-pepper-with-at-least-32-characters";
const challenge = () => prepareOtpChallenge({
  tenantId, phoneE164: "+201001234567", secret, nowSeconds: now,
});
const ipDigest = "ab".repeat(32);

type Call = { sql: string; fields: readonly SqlField[] };
const values = (fields: readonly SqlField[]) => Object.fromEntries(fields.map(f => [f.name, f.value]));
class FakeStagingDb implements CutClubStagingSqlPort {
  calls: Call[] = [];
  transactions = 0;
  db = "last132_agent";
  login = "drvo_agent";
  allowRateLimit = true;
  session: Record<string, unknown> | null = null;
  challengeRecord: Record<string, unknown> | null = null;
  reserveCount = 0;
  async transaction<T>(work: (tx: { execute(sqlText: string, fields?: readonly SqlField[]): Promise<SqlResult> }) => Promise<T>): Promise<T> {
    this.transactions++;
    return work({ execute: async (sqlText, fields = []) => {
      this.calls.push({ sql: sqlText, fields });
      const data = values(fields);
      if (sqlText.includes("DB_NAME() AS DatabaseName")) {
        return { rows: [{ DatabaseName: this.db, LoginName: this.login }], affected: 0 };
      }
      if (sqlText.includes("sp_getapplock")) return { rows: [{ LockResult: 0 }], affected: 0 };
      if (sqlText.includes("SELECT TOP (1) CreatedAtSeconds")) return { rows: [], affected: 0 };
      if (sqlText.includes("@allowed AS Allowed")) {
        return { rows: [{ Allowed: this.allowRateLimit ? true : false }], affected: 0 };
      }
      if (sqlText.includes("SET Status=N'replaced'")) return { rows: [], affected: 0 };
      if (sqlText.includes("INSERT INTO dbo.CustomerOtpChallenge")) {
        this.reserveCount++;
        this.challengeRecord = {
          ChallengeId: data.id, TenantId: data.tenant,
          PhoneDigest: data.phoneDigest, CodeDigest: data.codeDigest,
          Attempts: 0, Status: "pending", Revision: 0,
          CreatedAtSeconds: data.created, ExpiresAtSeconds: data.expires,
        };
        return { rows: [], affected: 1 };
      }
      if (sqlText.includes("SELECT TOP (1) ChallengeId")) {
        return { rows: this.challengeRecord && data.tenant === this.challengeRecord.TenantId &&
            data.id === this.challengeRecord.ChallengeId ? [this.challengeRecord] : [], affected: 0 };
      }
      if (sqlText.includes("UPDATE dbo.CustomerOtpChallenge") && sqlText.includes("@nextRevision")) {
        if (!this.challengeRecord || data.tenant !== this.challengeRecord.TenantId ||
            data.id !== this.challengeRecord.ChallengeId ||
            this.challengeRecord.Status !== "pending" ||
            this.challengeRecord.Revision !== data.oldRevision) return { rows: [], affected: 0 };
        this.challengeRecord = {
          ...this.challengeRecord,
          Attempts: data.attempts, Status: data.status, Revision: data.nextRevision,
        };
        return { rows: [], affected: 1 };
      }
      if (sqlText.includes("INSERT INTO dbo.CustomerSession")) {
        this.session = {
          TokenDigest: data.digest, TenantId: data.tenant, CustomerId: data.customer,
          VerifiedAtSeconds: data.verified, CreatedAtSeconds: data.created,
          ExpiresAtSeconds: data.expires, RevokedAtSeconds: null,
        };
        return { rows: [], affected: 1 };
      }
      if (sqlText.includes("SELECT TOP (1) TokenDigest")) {
        return { rows: this.session && data.tenant === this.session.TenantId &&
          Buffer.isBuffer(data.digest) && Buffer.isBuffer(this.session.TokenDigest) &&
          data.digest.equals(this.session.TokenDigest) &&
          this.session.RevokedAtSeconds === null ? [this.session] : [], affected: 0 };
      }
      if (sqlText.includes("UPDATE dbo.CustomerSession")) {
        if (!this.session || this.session.RevokedAtSeconds !== null ||
            this.session.TenantId !== data.tenant) return { rows: [], affected: 0 };
        this.session = { ...this.session, RevokedAtSeconds: data.now };
        return { rows: [], affected: 1 };
      }
      throw Error("unexpected test SQL");
    } });
  }
}

describe("CUT CLUB SQL staging OTP repository (#295): no real database", () => {
  it("is off by default: invalid tenant and unapproved flag cause ZERO DB operations", async () => {
    const db = new FakeStagingDb();
    const repo = createStagingCutClubOtpRepository(db, { enableStagingCandidate: false });
    const issued = challenge();
    expect(await repo.reserveChallenge({ challenge: issued.challenge, ipDigest, nowSeconds: now })).toBe("unavailable");
    expect(await repo.loadChallenge({ tenantId, challengeId: issued.challenge.id })).toBeNull();
    expect(await repo.commitAttempt({ before: issued.challenge, after: { ...issued.challenge, revision: 1, status: "consumed" } })).toBe(false);
    expect(await repo.getSession({ tenantId, tokenDigest: "ff".repeat(32) })).toBeNull();
    expect(await repo.revokeSession({ tenantId, tokenDigest: "ff".repeat(32), nowSeconds: now })).toBe(false);
    expect(db.transactions).toBe(0);
  });

  it("refuses production DB, wrong login and malformed tenant before ANY writes", async () => {
    const db = new FakeStagingDb();
    const repo = createStagingCutClubOtpRepository(db, { enableStagingCandidate: true });
    const issued = challenge();
    db.db = "last132";
    expect(await repo.reserveChallenge({ challenge: issued.challenge, ipDigest, nowSeconds: now })).toBe("unavailable");
    db.db = "last132_agent"; db.login = "sa";
    expect(await repo.reserveChallenge({ challenge: issued.challenge, ipDigest, nowSeconds: now })).toBe("unavailable");
    db.login = "drvo_agent";
    expect(await repo.loadChallenge({ tenantId: "cut-salon", challengeId: issued.challenge.id })).toBeNull();
    expect(db.reserveCount).toBe(0);
    expect(db.calls.some(c => c.sql.includes("INSERT INTO dbo.CustomerOtpChallenge"))).toBe(false);
  });

  it("reserves only digests under tenant lock + all three DB-atomic rate limits", async () => {
    const db = new FakeStagingDb();
    const repo = createStagingCutClubOtpRepository(db, { enableStagingCandidate: true });
    const issued = challenge();
    expect(await repo.reserveChallenge({ challenge: issued.challenge, ipDigest, nowSeconds: now })).toBe("stored");
    expect(db.reserveCount).toBe(1);
    const locks = db.calls.filter(c => c.sql.includes("sp_getapplock"));
    expect(locks).toHaveLength(1);
    expect(values(locks[0].fields).resource).toBe("CUTCLUB:OTP:" + tenantId);
    const limits = db.calls.filter(c => c.sql.includes("@allowed AS Allowed"));
    expect(limits).toHaveLength(3);
    expect(limits.map(c => values(c.fields).scope)).toEqual(["tenant", "ip", "phone"]);
    const serialized = JSON.stringify(db.calls);
    expect(serialized).not.toContain("+201001234567");
    expect(serialized).not.toContain(issued.codeForDelivery);
    expect(db.challengeRecord?.Status).toBe("pending");
  });

  it("denies rate-limited issue and never inserts a challenge", async () => {
    const db = new FakeStagingDb();
    db.allowRateLimit = false;
    const repo = createStagingCutClubOtpRepository(db, { enableStagingCandidate: true });
    expect(await repo.reserveChallenge({ challenge: challenge().challenge, ipDigest, nowSeconds: now })).toBe("rate_limited");
    expect(db.reserveCount).toBe(0);
  });

  it("commits correct code exactly once under revision CAS; replay fails closed", async () => {
    const db = new FakeStagingDb();
    const repo = createStagingCutClubOtpRepository(db, { enableStagingCandidate: true });
    const issued = challenge();
    expect(await repo.reserveChallenge({ challenge: issued.challenge, ipDigest, nowSeconds: now })).toBe("stored");
    const input = { tenantId, challengeId: issued.challenge.id, code: issued.codeForDelivery,
      secret, nowSeconds: now + 1, repository: repo };
    const result = await Promise.all([
      verifyOtpAfterAtomicCommit(input), verifyOtpAfterAtomicCommit(input),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(db.challengeRecord).toMatchObject({ Status: "consumed", Revision: 1 });
    expect(await verifyOtpAfterAtomicCommit(input)).toBe(false);
    expect(await repo.loadChallenge({ tenantId: otherTenant, challengeId: issued.challenge.id })).toBeNull();
  });

  it("saves only a digest-only session, reads by tenant and revokes once", async () => {
    const db = new FakeStagingDb();
    const repo = createStagingCutClubOtpRepository(db, { enableStagingCandidate: true });
    const material = prepareOpaqueSession({
      tenantId, customerId: 12, verifiedAtSeconds: now - 10, nowSeconds: now,
    });
    expect(await repo.createSession(material.record)).toBe(true);
    const got = await repo.getSession({ tenantId, tokenDigest: material.record.tokenDigest });
    expect(got).toEqual(material.record);
    expect(await repo.getSession({ tenantId: otherTenant, tokenDigest: material.record.tokenDigest })).toBeNull();
    expect(JSON.stringify(db.calls)).not.toContain(material.tokenForCookie);
    expect(await repo.revokeSession({ tenantId, tokenDigest: material.record.tokenDigest, nowSeconds: now + 3 })).toBe(true);
    expect(await repo.revokeSession({ tenantId, tokenDigest: material.record.tokenDigest, nowSeconds: now + 4 })).toBe(false);
    expect(await repo.getSession({ tenantId, tokenDigest: material.record.tokenDigest })).toBeNull();
  });

  it("keeps SQL schema staging-only and enforces tenant FK, digest storage, unique pending OTP and session TTL", () => {
    const ddl = readFileSync(resolve(process.cwd(), "docs/cut-club/sql/customer-auth-staging-schema.sql"), "utf8");
    expect(ddl).toContain("DB_NAME() <> N'last132_agent'");
    expect(ddl).toContain("SUSER_SNAME() <> N'drvo_agent'");
    for (const table of ["CustomerOtpChallenge", "CustomerOtpRateLimit", "CustomerSession", "CustomerAuthAudit"]) {
      expect(ddl).toContain("CREATE TABLE dbo." + table);
    }
    expect(ddl.match(/FOREIGN KEY \(TenantId\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(ddl).toContain("UX_CutOtp_Tenant_PendingPhone");
    expect(ddl).toContain("WHERE Status = N'pending'");
    expect(ddl).toContain("ExpiresAtSeconds - CreatedAtSeconds <= 300");
    expect(ddl).toContain("ExpiresAtSeconds - CreatedAtSeconds <= 7200");
    expect(ddl).not.toMatch(/\b(?:PlainOtp|OtpCode|RawPhone|RawToken|CookieToken)\b/i);
    expect(ddl).not.toMatch(/\bUSE\s+(?:last132|master)\b/i);
  });
});
