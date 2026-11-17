# CUT CLUB 2.0 — durable customer OTP / session implementation candidate (#295)

**Status: REVIEW-ONLY Draft.** This is a meaningful backend implementation layer, but it is deliberately **not connected to live customer HTTP routes, real SMS/WhatsApp providers, production DB or browser cookies**. It must not be called a working customer login until the gates below pass.

## Implemented in code

1. `docs/cut-club/sql/customer-auth-staging-schema.sql`: manually reviewed SQL Server DDL with a hard `DB_NAME()='last132_agent'` and `SUSER_SNAME()='drvo_agent'` staging guard, no reference to production DB. Tenant-FK entities:
   - `CustomerOtpChallenge`: random 32-character challenge ID, tenant UUID, HMAC phone/IP/OTP digests (BINARY(32)), status, revision CAS, TTL ≤300 seconds, attempts ≤5, unique pending phone per tenant.
   - `CustomerOtpRateLimit`: tenant + scope + subject HMAC + fixed window, transactional counters, constraints.
   - `CustomerSession`: only SHA-256 opaque 256-bit token **digest**, tenant/customer, 2-hour max expiry, revocation timestamp.
   - `CustomerAuthAudit`: non-identifying event types/results. No raw phone, OTP or cookie in DDL.
2. `src/lib/cut-club/sqlOtpRepository.ts`: tenant-scoped, transaction-bound implementation of existing `OtpDurableRepository`:
   - database **and SQL login** checked inside every transaction. No DB call at all when `enableStagingCandidate` is false.
   - per-tenant SQL application lock serializes rate-limit counters + pending phone replacement across app workers.
   - per-tenant hourly 100 issue cap, per-IP 10/15-min cap, per-phone 3/15-min cap, 60s same-phone cooldown. These are INITIAL SECURITY GUARDRAILS, pending ops/privacy/vendor approval.
   - OTP CAS by tenant, challenge ID, HMAC phone/code digests, prior status, attempt count, revision and expiry: exactly one committed consumer.
   - digest-only session create/read/revoke by tenant; query is never authorization by itself.
3. `src/lib/cut-club/sqlOtpMssqlPort.ts`: explicitly constructed `mssql` transaction adapter with typed parameters and automatic rollback if a work unit fails. Does not open a connection on import or create a global pool.
4. `src/lib/cut-club/customerAuthFlow.ts`: provider-neutral trusted-server orchestration:
   - only deliver an OTP **after** durable rate-limit reservation;
   - reject mismatched original challenge phone digest;
   - consume OTP with committed CAS, THEN resolve exactly one active tenant-owned customer, THEN create a durable opaque session;
   - deny ambiguous/shared phone numbers, cross-tenant matches, delivery failures or session insert failures;
   - authorize a session only through stored token digest + expiration/revocation check; logout revokes durable token.
   - No real provider, cookies, routes or browser account IDs.
5. Synthetic tests under `src/lib/__tests__/cutClubSqlOtpRepository.test.ts` and `cutClubCustomerAuthFlow.test.ts` cover no-DB disabled path, wrong DB/login, rate-limit and tenant lock, single-use OTP, CAS/replay, failure/ambiguity, digest-only sessions and revoke. Mandatory CI steps added.

## Actual real-world dependencies — MUST happen first

| Dependency | Operator-grade acceptance requirement | Status |
|---|---|---|
| Tenant/customer authority | Confirm `dbo.Tenant` UUID to old `TblClient.ClientID` INT mapping per salon/branch, duplicates and shared phones; synthetic 2-account/2-tenant staging tests | UNVERIFIED |
| Staging schema | Dedicated operator to inspect metadata, stage DDL under manifest/checksum/backup/rollback plan, then validate constraints/indexes without real customer rows | NOT APPLIED |
| OTP provider | Approve WhatsApp/SMS transporter contract, delivery report, pricing, sender and retry handling | NOT CONNECTED |
| Trust boundary | BFF trusted branch-to-tenant, proxy IP extraction, E.164 normalization and secret rotation; never client-supplied tenant or caller-chosen clientId | NOT CONNECTED |
| Cookie/BFF | Host-only Secure HttpOnly SameSite cookie, CSRF/Origin defenses and revocation/logout; no browser-exposed session token in JSON | NOT IMPLEMENTED |
| Member Wallet | New server-verified Casher private GET APIs with strict tenant+owner scope and record ownership, then existing BFF/DTO UI integrated | NOT IMPLEMENTED |
| Financial actions | Atomic ledger/balance/stock/voucher settlement, idempotency, availability and anti-abuse; original operations quarantined only in Draft | NOT IMPLEMENTED |
| Release | Synthetic concurrency on actual staging SQL, compatibility with guest booking, independent security review, VPS rollback and explicit owner sign-off on exact head | BLOCKED |

## Operator safety

- The SQL file is kept in **docs**, outside the auto-discovered migration path. Do not run SQL automatically in CI or production.
- The production Casher process does **not** construct the OTP SQL adapter, and no API route calls the flow. Merely merging this candidate would NOT enable login; merging any older quarantine without replacement might disrupt existing customer functionality.
- Staging schema is optional design evidence until manually approved; tests run on synthetic fixtures only.
- Logs/errors must not contain OTP, telephone, token or customer records. Audit / monitoring implementation is needed before live service.
- Session TTL = 2 hours in this candidate, matching offline domain PR #256; the conflicting 7-day optional website blueprint requires one product decision before enabling production.
- **Rate caps and fixed-window boundary behavior must undergo security and UX review**; do not advertise them as guaranteed protection against distributed abuse.
- A real operator must supply sanitized non-production schema evidence for the existing [preflight PR #259](https://github.com/tarek-saad-dev/casher/pull/259). No Staging data accessed in this draft.

### Release disposition

**NO-GO** for production. Preserve all Coins, vouchers and bookings; do not enable or deploy until complete end-to-end staging and explicit human approval.
