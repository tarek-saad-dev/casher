/**
 * CUT CLUB 2.0 staging-only durable SQL OTP repository (#295).
 * NOT connected to HTTP routes. Disabled unless an explicitly constructed,
 * trusted staging DB port is provided and enableStagingCandidate === true.
 *
 * Caller must have already resolved an authoritative UUID tenant, normalized
 * the target phone, and HMAC-digested trusted proxy IP. Never accept tenant,
 * IP or customer IDs directly from a public request. No raw OTP, phone, or
 * session token is persisted.
 */
import { createHash } from "node:crypto";
import type { OpaqueSessionRecord, OtpChallenge, OtpDurableRepository, OtpStatus } from "./otpDomain";

export type SqlFieldKind = "uuid" | "bytes32" | "varchar32" | "varchar64" | "nvarchar20" | "nvarchar8" | "int" | "bigint";
export type SqlField = Readonly<{ name: string; kind: SqlFieldKind; value: string | number | Buffer }>;
export type SqlResult = Readonly<{ rows: readonly Record<string, unknown>[]; affected: number }>;

export interface CutClubSqlTransaction {
  execute(sqlText: string, fields?: readonly SqlField[]): Promise<SqlResult>;
}
export interface CutClubStagingSqlPort {
  /** One actual SQL Server transaction, not a process-local mutex or cache. */
  transaction<T>(work: (tx: CutClubSqlTransaction) => Promise<T>): Promise<T>;
}

const p = (name: string, kind: SqlFieldKind, value: string | number | Buffer): SqlField => ({ name, kind, value });
const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{64}$/i.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const int = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const b32 = (value: string) => Buffer.from(value, "hex");
const toHex = (v: unknown): string | null => Buffer.isBuffer(v) && v.byteLength === 32 ? v.toString("hex") : null;
const statuses = new Set<OtpStatus>(["pending", "consumed", "locked", "expired", "replaced", "delivery_failed"]);
const unavailable = new Error("CUT_CLUB_AUTH_REPOSITORY_UNAVAILABLE");

const CHECK_STAGING = `
SELECT DB_NAME() AS DatabaseName, SUSER_SNAME() AS LoginName;
`;
const LOCK_TENANT_RESERVE = `
DECLARE @lockResult INT;
EXEC @lockResult = sp_getapplock
  @Resource=@resource,
  @LockMode='Exclusive',
  @LockOwner='Transaction',
  @LockTimeout=1500;
SELECT @lockResult AS LockResult;
`;
const CHECK_COOLDOWN = `
SELECT TOP (1) CreatedAtSeconds
FROM dbo.CustomerOtpChallenge WITH (UPDLOCK, HOLDLOCK)
WHERE TenantId=@tenant AND PhoneDigest=@phoneDigest
ORDER BY CreatedAtSeconds DESC;
`;
const UPSERT_RATE = `
DECLARE @allowed BIT = 0;
UPDATE dbo.CustomerOtpRateLimit WITH (UPDLOCK, HOLDLOCK)
  SET Attempts=Attempts+1, UpdatedAtSeconds=@now
WHERE TenantId=@tenant AND Scope=@scope AND SubjectDigest=@subject
  AND BucketStartSeconds=@bucket AND Attempts < @cap;
IF @@ROWCOUNT=1 SET @allowed=1;
ELSE IF NOT EXISTS (
  SELECT 1 FROM dbo.CustomerOtpRateLimit WITH (UPDLOCK, HOLDLOCK)
  WHERE TenantId=@tenant AND Scope=@scope AND SubjectDigest=@subject
    AND BucketStartSeconds=@bucket
)
BEGIN
  INSERT INTO dbo.CustomerOtpRateLimit
    (TenantId, Scope, SubjectDigest, BucketStartSeconds, Attempts, UpdatedAtSeconds)
  VALUES (@tenant, @scope, @subject, @bucket, 1, @now);
  SET @allowed=1;
END;
SELECT @allowed AS Allowed;
`;
const REPLACE_PENDING = `
UPDATE dbo.CustomerOtpChallenge
SET Status=N'replaced', Revision=Revision+1
WHERE TenantId=@tenant AND PhoneDigest=@phoneDigest AND Status=N'pending';
`;
const INSERT_CHALLENGE = `
INSERT INTO dbo.CustomerOtpChallenge
 (ChallengeId,TenantId,PhoneDigest,IpDigest,CodeDigest,SecretVersion,Attempts,Status,Revision,CreatedAtSeconds,ExpiresAtSeconds)
VALUES (@id,@tenant,@phoneDigest,@ipDigest,@codeDigest,1,0,N'pending',0,@created,@expires);
`;
const LOAD_CHALLENGE = `
SELECT TOP (1) ChallengeId, TenantId, PhoneDigest, CodeDigest,
       Attempts, Status, Revision, CreatedAtSeconds, ExpiresAtSeconds
FROM dbo.CustomerOtpChallenge
WHERE TenantId=@tenant AND ChallengeId=@id;
`;
const COMMIT_CHALLENGE = `
UPDATE dbo.CustomerOtpChallenge
SET Status=@status, Attempts=@attempts, Revision=@nextRevision
WHERE TenantId=@tenant AND ChallengeId=@id AND PhoneDigest=@phoneDigest
  AND CodeDigest=@codeDigest AND Status=N'pending'
  AND Revision=@oldRevision AND Attempts=@oldAttempts
  AND ExpiresAtSeconds=@expires;
`;
const INSERT_SESSION = `
INSERT INTO dbo.CustomerSession
 (TokenDigest,TenantId,CustomerId,VerifiedAtSeconds,CreatedAtSeconds,ExpiresAtSeconds,RevokedAtSeconds)
VALUES (@digest,@tenant,@customer,@verified,@created,@expires,NULL);
`;
const LOAD_SESSION = `
SELECT TOP (1) TokenDigest,TenantId,CustomerId,VerifiedAtSeconds,CreatedAtSeconds,
       ExpiresAtSeconds,RevokedAtSeconds
FROM dbo.CustomerSession
WHERE TenantId=@tenant AND TokenDigest=@digest AND RevokedAtSeconds IS NULL;
`;
const REVOKE_SESSION = `
UPDATE dbo.CustomerSession
  SET RevokedAtSeconds=@now
WHERE TenantId=@tenant AND TokenDigest=@digest AND RevokedAtSeconds IS NULL
  AND CreatedAtSeconds <= @now;
`;

function decodeChallenge(row: Record<string, unknown> | undefined): OtpChallenge | null {
  if (!row) return null;
  const phoneDigest = toHex(row.PhoneDigest);
  const codeDigest = toHex(row.CodeDigest);
  if (!phoneDigest || !codeDigest || typeof row.ChallengeId !== "string" ||
      !/^[A-Za-z\d_-]{32}$/.test(row.ChallengeId) ||
      !uuid(row.TenantId) || !int(row.CreatedAtSeconds) ||
      !int(row.ExpiresAtSeconds) ||
      !nonnegative(row.Attempts) || row.Attempts > 5 ||
      !nonnegative(row.Revision) || !statuses.has(row.Status as OtpStatus)) return null;
  return Object.freeze({
    id: row.ChallengeId,
    tenantId: row.TenantId,
    phoneDigest, codeDigest,
    attempts: row.Attempts,
    status: row.Status as OtpStatus,
    createdAt: row.CreatedAtSeconds,
    expiresAt: row.ExpiresAtSeconds,
    revision: row.Revision,
  });
}
function decodeSession(row: Record<string, unknown> | undefined): OpaqueSessionRecord | null {
  if (!row || !uuid(row.TenantId) || !int(row.CustomerId) ||
      !int(row.VerifiedAtSeconds) || !int(row.CreatedAtSeconds) || !int(row.ExpiresAtSeconds)) return null;
  const tokenDigest = toHex(row.TokenDigest);
  if (!tokenDigest || (row.RevokedAtSeconds !== null && !int(row.RevokedAtSeconds))) return null;
  return Object.freeze({
    tokenDigest,
    tenantId: row.TenantId,
    customerId: row.CustomerId,
    verifiedAt: row.VerifiedAtSeconds,
    createdAt: row.CreatedAtSeconds,
    expiresAt: row.ExpiresAtSeconds,
    revokedAt: row.RevokedAtSeconds as number | null,
  });
}

/**
 * REVIEW CANDIDATE ONLY. Disabled state performs ZERO DB operations.
 * All methods require the actual driver to confirm staging DB/login *inside*
 * its SQL transaction, not merely trust environment variables.
 */
export function createStagingCutClubOtpRepository(
  port: CutClubStagingSqlPort,
  options: Readonly<{ enableStagingCandidate: boolean }>,
): OtpDurableRepository {
  const enabled = options.enableStagingCandidate === true;
  async function stage<T>(operation: (tx: CutClubSqlTransaction) => Promise<T>): Promise<T> {
    if (!enabled) throw unavailable;
    return port.transaction(async tx => {
      const proof = await tx.execute(CHECK_STAGING);
      if (proof.rows.length !== 1 ||
          proof.rows[0].DatabaseName !== "last132_agent" ||
          proof.rows[0].LoginName !== "drvo_agent") throw unavailable;
      return operation(tx);
    });
  }

  return {
    async reserveChallenge({ challenge, ipDigest, nowSeconds }) {
      if (!enabled || !uuid(challenge.tenantId) || !hex(ipDigest) ||
          !hex(challenge.phoneDigest) || !hex(challenge.codeDigest) ||
          !/^[A-Za-z\d_-]{32}$/.test(challenge.id) ||
          !int(nowSeconds) || challenge.status !== "pending" ||
          challenge.revision !== 0 || challenge.attempts !== 0 ||
          challenge.createdAt !== nowSeconds ||
          challenge.expiresAt - nowSeconds !== 300) return "unavailable";
      try {
        return await stage(async tx => {
          const tenant = p("tenant", "uuid", challenge.tenantId);
          // Tenant-level application lock serializes every rate limit scope
          // and same-phone replacement across workers, not just this process.
          const lock = await tx.execute(LOCK_TENANT_RESERVE, [
            p("resource", "varchar64", "CUTCLUB:OTP:" + challenge.tenantId),
          ]);
          if (!lock.rows.length || Number(lock.rows[0].LockResult) < 0) return "unavailable";

          const cooldown = await tx.execute(CHECK_COOLDOWN, [tenant,
            p("phoneDigest", "bytes32", b32(challenge.phoneDigest))]);
          const lastSent = cooldown.rows[0]?.CreatedAtSeconds;
          if (typeof lastSent === "number" && lastSent >= nowSeconds - 60) return "rate_limited";

          const scopeRules = [
            { name: "tenant", subject: createHash("sha256").update("cutclub:tenant:").update(challenge.tenantId).digest(), seconds: 3600, cap: 100 },
            { name: "ip", subject: b32(ipDigest), seconds: 900, cap: 10 },
            { name: "phone", subject: b32(challenge.phoneDigest), seconds: 900, cap: 3 },
          ] as const;
          for (const rule of scopeRules) {
            const result = await tx.execute(UPSERT_RATE, [tenant,
              p("scope", "nvarchar8", rule.name),
              p("subject", "bytes32", rule.subject),
              p("bucket", "bigint", Math.floor(nowSeconds / rule.seconds) * rule.seconds),
              p("now", "bigint", nowSeconds),
              p("cap", "int", rule.cap),
            ]);
            if (result.rows[0]?.Allowed !== true && result.rows[0]?.Allowed !== 1) {
              // Abort transaction so previous counters are not consumed.
              throw new Error("CUT_CLUB_RATE_LIMITED");
            }
          }
          await tx.execute(REPLACE_PENDING, [tenant,
            p("phoneDigest", "bytes32", b32(challenge.phoneDigest))]);
          const inserted = await tx.execute(INSERT_CHALLENGE, [
            p("id", "varchar32", challenge.id), tenant,
            p("phoneDigest", "bytes32", b32(challenge.phoneDigest)),
            p("ipDigest", "bytes32", b32(ipDigest)),
            p("codeDigest", "bytes32", b32(challenge.codeDigest)),
            p("created", "bigint", challenge.createdAt),
            p("expires", "bigint", challenge.expiresAt),
          ]);
          if (inserted.affected !== 1) throw unavailable;
          return "stored";
        });
      } catch (error) {
        return error instanceof Error && error.message === "CUT_CLUB_RATE_LIMITED" ? "rate_limited" : "unavailable";
      }
    },
    async loadChallenge({ tenantId, challengeId }) {
      if (!enabled || !uuid(tenantId) || !/^[A-Za-z\d_-]{32}$/.test(challengeId)) return null;
      try {
        return await stage(async tx => {
          const result = await tx.execute(LOAD_CHALLENGE, [
            p("tenant", "uuid", tenantId), p("id", "varchar32", challengeId),
          ]);
          return decodeChallenge(result.rows[0]);
        });
      } catch { return null; }
    },
    async commitAttempt({ before, after }) {
      if (!enabled || !uuid(before.tenantId) || before.tenantId !== after.tenantId ||
          before.id !== after.id || before.status !== "pending" ||
          !hex(before.phoneDigest) || before.phoneDigest !== after.phoneDigest ||
          !hex(before.codeDigest) || before.codeDigest !== after.codeDigest ||
          !/^[A-Za-z\d_-]{32}$/.test(before.id) ||
          !nonnegative(before.revision) || after.revision !== before.revision + 1 ||
          !nonnegative(before.attempts) || !nonnegative(after.attempts) ||
          after.attempts > 5 || !statuses.has(after.status) ||
          after.createdAt !== before.createdAt || after.expiresAt !== before.expiresAt ||
          !["consumed", "pending", "locked", "expired", "replaced", "delivery_failed"].includes(after.status))
        return false;
      try {
        return await stage(async tx => {
          const result = await tx.execute(COMMIT_CHALLENGE, [
            p("tenant", "uuid", before.tenantId),
            p("id", "varchar32", before.id),
            p("phoneDigest", "bytes32", b32(before.phoneDigest)),
            p("codeDigest", "bytes32", b32(before.codeDigest)),
            p("status", "nvarchar20", after.status),
            p("attempts", "int", after.attempts),
            p("nextRevision", "int", after.revision),
            p("oldRevision", "int", before.revision),
            p("oldAttempts", "int", before.attempts),
            p("expires", "bigint", before.expiresAt),
          ]);
          return result.affected === 1;
        });
      } catch { return false; }
    },
    async createSession(record) {
      if (!enabled || !uuid(record.tenantId) || !hex(record.tokenDigest) ||
          !int(record.customerId) || !int(record.verifiedAt) ||
          !int(record.createdAt) || !int(record.expiresAt) ||
          record.revokedAt !== null ||
          record.createdAt < record.verifiedAt ||
          record.createdAt - record.verifiedAt > 300 ||
          record.expiresAt - record.createdAt > 7200 ||
          record.expiresAt <= record.createdAt) return false;
      try {
        return await stage(async tx => {
          const r = await tx.execute(INSERT_SESSION, [
            p("tenant", "uuid", record.tenantId),
            p("digest", "bytes32", b32(record.tokenDigest)),
            p("customer", "int", record.customerId),
            p("verified", "bigint", record.verifiedAt),
            p("created", "bigint", record.createdAt),
            p("expires", "bigint", record.expiresAt),
          ]);
          return r.affected === 1;
        });
      } catch { return false; }
    },
    async getSession({ tenantId, tokenDigest }) {
      if (!enabled || !uuid(tenantId) || !hex(tokenDigest)) return null;
      try {
        return await stage(async tx => {
          const r = await tx.execute(LOAD_SESSION, [
            p("tenant", "uuid", tenantId),
            p("digest", "bytes32", b32(tokenDigest)),
          ]);
          const session = decodeSession(r.rows[0]);
          // This is a data-access primitive, not authorization. Caller MUST
          // verify token digest, expiration and revocation with authoritative now.
          return session?.tenantId === tenantId && session.tokenDigest === tokenDigest
            ? session : null;
        });
      } catch { return null; }
    },
    async revokeSession({ tenantId, tokenDigest, nowSeconds }) {
      if (!enabled || !uuid(tenantId) || !hex(tokenDigest) || !int(nowSeconds)) return false;
      try {
        return await stage(async tx => {
          const r = await tx.execute(REVOKE_SESSION, [
            p("tenant", "uuid", tenantId),
            p("digest", "bytes32", b32(tokenDigest)),
            p("now", "bigint", nowSeconds),
          ]);
          return r.affected === 1;
        });
      } catch { return false; }
    },
  };
}
