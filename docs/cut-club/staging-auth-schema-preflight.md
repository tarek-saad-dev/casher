# CUT CLUB OTP / Customer Session — Staging Schema Preflight

Issue #257 · Parent #243 · 2026-11-14
Status: DESIGN ONLY, READ-ONLY. Not an executable migration or live-login authorization.

## Why this preflight is mandatory

Repository migration db/migrations/add-drvo-003-platform-core.sql defines dbo.Tenant.TenantId as UNIQUEIDENTIFIER and dbo.LegacyIdMap as a tenant-scoped mapping table. Older /api/public/client endpoints query dbo.TblClient.ClientID (INT) without proven tenant/subject authorization. A verified phone, request-supplied clientId or salon branch ID does not prove unique customer ownership under the new tenant system.

Never invent a TenantId foreign key on TblClient or assume a legacy SalonID equals a new TenantId. Exact tenant→client relationships need verified staging schema and synthetic tests first.

## Read-only staging metadata query (NOT EXECUTED)

Run only from the guarded staging executor under database last132_agent and login drvo_agent. This queries schema metadata; no customer rows. The guard refuses other DB/user identities.

    SET NOCOUNT ON;
    IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
      THROW 51001, 'CUT CLUB staging identity required', 1;

    SELECT DB_NAME() AS StagingDatabase, SUSER_SNAME() AS StagingLogin;

    SELECT t.name AS TableName, c.name AS ColumnName,
           ty.name AS DataType, c.max_length, c.is_nullable
    FROM sys.tables t
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE t.name IN (
      N'Tenant', N'LegacyIdMap', N'TblClient', N'TblClientLoyalty',
      N'TblClientInventory', N'CustomerOtpChallenge',
      N'CustomerOtpRateLimit', N'CustomerSession'
    )
    ORDER BY t.name, c.column_id;

    SELECT OBJECT_NAME(parent_object_id) AS ParentTable,
           name AS ForeignKeyName,
           OBJECT_NAME(referenced_object_id) AS ReferencedTable
    FROM sys.foreign_keys
    WHERE OBJECT_NAME(parent_object_id) IN (
      N'TblClient', N'LegacyIdMap', N'CustomerOtpChallenge', N'CustomerSession'
    );

Do not run on production last132, export real phone numbers, or infer duplicate-phone rates from metadata. Test ambiguous account mapping through synthetic staging fixtures only.

## Proposed schema (not executable DDL)

- CustomerOtpChallenge: random ChallengeId PK; authoritative TenantId UUID; PhoneDigest/CodeDigest binary(32) keyed; SecretVersion; attempts 0–5; status pending/consumed/locked/expired/replaced/delivery_failed; revision; created/expires/sent timestamps. Unique active tenant+phone constraint and atomic compare-and-swap.
- CustomerOtpRateLimit: trusted TenantId, scope (phone/IP/tenant), keyed digest, window, count and last send. Unique window counter; transaction-safe reservation and cooldown.
- CustomerSession: TokenDigest binary(32) PK, authoritative tenant+customer mapping, verified/created/expiry/revoked timestamps, optional rotation family. Store only token digest, never raw cookie token.
- CustomerAuthAudit: tenant + event type + generic result + timestamp, HMAC-correlated IDs; no OTP, raw phone, session token, or wallet data.

Session expiry is an unresolved decision: website blueprint PR #39 proposes 7-day absolute / 24h idle as an option, while offline PR #256 has a conservative 2-hour max. Agree a single explicit policy before real issuance. OTP sending provider/cost, limits, shared-phone recovery and tenant-to-customer binding are likewise not settled.

## Atomicity and threat requirements

1. Resolve tenant from trusted server context. Normalize phone to E.164, use a keyed digest and trusted proxy-derived IP digest.
2. Reserve rate-limit window and replace previous pending challenge in a single durable transaction BEFORE OTP delivery.
3. Mark failed provider send unusable; never return/log the OTP or reveal customer existence.
4. Consume only via compare-and-swap: WHERE ChallengeId=@id AND TenantId=@tenant AND Revision=@old AND Status='pending'. Correct OTP succeeds only if exactly one row was committed. Wrong attempts count and lock across concurrent workers and restarts.
5. After atomic OTP consume, resolve exactly one active tenant-owned customer in authoritative staging-backed source. Ambiguous/shared phone must stop and use recovery, never a browser account selector.
6. Create digest-only 256-bit opaque session; set host-only Secure HttpOnly cookie from trusted website BFF; validate tenant+customer ownership on EVERY upstream member read/write.
7. Revoke on logout, account recovery and rotation; keep no-store/cache privacy, origin/CSRF protections and audit logs without secrets.

## Migration approval rules

Follow docs/drvo/MIGRATION-CONTROL-PLANE.md. A future migration must use central manifest/checksums, kind/risk/backup/lock/rollback metadata, guarded staging database last132_agent ONLY, synthetic concurrency tests, then read-only production PLAN and separate explicit human migration APPLY approval bound to exact PR head/manifest digest. Application merge approval is separately required and auto-triggers deploy. This preflight has NO APPLY or migration file.

## Required tests before B2 is called implemented

- Two parallel sends for same phone never bypass cooldown/limits.
- Two parallel verifications of same code: exactly one atomic consume.
- Five incorrect attempts lock across workers; expiry/replaced/failed-delivery deny.
- Worker restart preserves consumption/revocation state.
- Tenant mismatch and guessed clientId cannot access another member.
- Duplicate or inactive phone matches fail closed.
- Schema has declared tenant constraints, rollback and checksum traceability.

## Current status

DONE: documented source mismatch, schema-only inspection, proposed tables and concurrency/recovery gates.
BLOCKED: B1 independent security review, tenant-client authority proof, OTP provider/channel/operating cost, session lifetime decision, real manifest migration and staging DB verification.

No connections, production database operations, OTP sends, customer/booking mutations or merges were performed.

## Update: executable **offline** metadata checker (2026-11-14)

Added `scripts/cut-club/customer-auth-schema-preflight.mjs` and Node test fixtures to the **existing Draft PR #259**, with a targeted CI step. The utility has NO DB driver, network access, SQL execution or credentials:

```sh
# Print a guarded, metadata-only SQL statement for an authorized operator.
node scripts/cut-club/customer-auth-schema-preflight.mjs --sql

# Optional: inspect a sanitized JSON result captured from the DEDICATED
# staging executor; do not upload sensitive rows or run in production.
node scripts/cut-club/customer-auth-schema-preflight.mjs --check sanitized-staging-metadata.json
```

The SQL refuses anything except `last132_agent` / `drvo_agent` and reads only `sys.tables`, `sys.columns`, `sys.types`, `sys.foreign_keys`. The offline checker verifies expected `dbo.Tenant`, `dbo.LegacyIdMap` and `dbo.TblClient` column **types and metadata** and the mapping table's FK to Tenant. It never inspects any customer row. It accepts only metadata JSON; an invalid shape or incorrect database/login fails closed.

**A successful schema fingerprint is NOT identity proof.** Every result includes `customerIdentityProven: false` and `readyToIssueOtp: false`, even if all expected tables exist. It does not prove that `LegacyIdMap` maps all CUT Salon customers, disambiguates shared phone numbers, or that CustomerSession/Challenge schemas are safe. A separate source-of-truth review, real staging concurrency validation and provider decision are still mandatory before any OTP use.

No query was executed on staging or production by this update; no migration was added or applied. Previous status lines describing the original preflight as documentation-only refer to the initial commit; the *current* PR now contains this offline operator tool and tests.
