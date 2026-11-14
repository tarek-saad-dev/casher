# CUT CLUB 2.0 — OTP domain and opaque customer sessions (Sprint B1)

> Parent [#243](https://github.com/tarek-saad-dev/casher/issues/243) · Sprint [#255](https://github.com/tarek-saad-dev/casher/issues/255) · Predecessor [#249](https://github.com/tarek-saad-dev/casher/issues/249)
> This PR adds **offline, Node-only domain helpers and tests**. They are not reachable over HTTP, cannot send an OTP, cannot authorize any existing member API and do not create a browser login. No production database or customer data accessed.

## Decisions and security invariants

1. The CUT CLUB browser login uses its **own revocable opaque session**. Never use staff \`pos_session\`, editable phone lookup, localStorage or caller-supplied clientId for customer authentication.
2. A six-digit OTP comes from secure OS randomness. Each challenge has a separate 192-bit random identifier, binds the tenant and canonical E.164 phone by a **keyed digest**, and stores only a keyed OTP digest, not plaintext codes or phone.
3. OTP is valid for at most **5 minutes**, with **5 attempts** and a **single successful consume**. Challenges must be atomically consumed; retries/replacements/failed delivery cannot authenticate. The domain \`checkOtpAttempt\` result is a proposed state transition, NOT an authorization token.
4. A **dedicated** 32+ byte secret is required, distinct from staff auth and any public web secret. Missing/short secret fails closed. Secrets must come from managed deployment environment; never repo or logs.
5. A verified phone **is not guaranteed to map to exactly one customer**. After OTP consume, resolve the tenant-scoped phone from trusted records, reject duplicate/shared phone mapping and inactive profiles, and require a separate identity-resolution/support flow.
6. After successful transactional OTP consume and authoritative user binding, generate a 256-bit opaque browser cookie token. Persist **only its digest** in a revocable server-side session record, with 2-hour max TTL. Cookie: host-only, HttpOnly, Secure, SameSite=Lax or stricter after CSRF design, Path=/ or /club; rotate on login. The UI never receives session material in JSON/URLs.
7. Login, logout, and mutations require CSRF/Origin protections, reasonable login throttling, no-store, enumeration-resistant responses, audit without secret or unnecessary PII, and server-side tenant/resource checks.
8. All sensitive legacy public client endpoints are still at risk until separately migrated. This module does not cure them, and is not safe to merge as a purported "auth fix".

## Proposed server adapter contract (NOT implemented)

Use **durable persistence** (SQL Server or approved equivalent) with atomic updates:

- \`reserveChallenge(tenantId, phoneDigest, ipDigest, window)\`: enforce quotas **atomically** before creation. Suggested starting policy, subject to security/operations approval: max 3 sends/phone/hour, max 10 sends/IP/hour, min 60s resend gap, one active challenge per tenant+phone. Normalize IP only from trusted proxy headers; hash or truncate before storage. This must be effective across workers and reboots; in-memory counters are NOT acceptable.
- \`insertChallenge(record)\`: persist under tenant, unique id; replace any prior pending challenge in the **same transaction** so an old OTP cannot succeed. Store immutable tenant/phone digest, secret version, createdAt, expiresAt, attempt count, status, revision.
- \`deliverCode(code)\`: send via approved SMS/WhatsApp provider only after reservation and durable insert, never log code or expose it in public responses. On provider failure, mark challenge \`delivery_failed\` in the store and return a generic response.
- \`verifyAndConsume(challengeId, submittedCode)\`: read row under trusted tenant; compute \`checkOtpAttempt\`; persist new state with compare-and-swap \`WHERE ChallengeId=@id AND Revision=@old AND Status='pending'\` in **one transaction**. Return success only when that update commits exactly one row. Lock and expire atomically; concurrent requests never double-consume.
- \`findCustomersByVerifiedPhone(tenantId, phoneDigest)\`: **authoritative** tenant-scoped match. Do not bind customer id supplied from the browser or use a client-side clientId; reject ambiguous matches rather than arbitrarily select.
- \`createSession(record)\`: insert digest-only row with tenant/customer/OTP verification evidence. Set secure, host-only opaque cookie server-side after commit, no storing the raw token in logs.
- \`lookupSession(tokenDigest, trustedTenant)\`: authorize server-side against unexpired, non-revoked row; validate ownership for **every** resource query/transaction.
- \`revokeSession(tokenDigest)\`: delete or mark revoked atomically on logout, rotation, account closure and staff intervention. Optionally revoke all sessions on phone/account recovery. Schedule bounded TTL purge.

Database fields (proposal, subject to DRVO migration control, never auto-applied):

| Entity | Fields |
|---|---|
| CustomerOtpChallenge | Id PK, TenantId, PhoneDigest, IpDigest, CodeDigest, SecretVersion, Status, Attempts, Revision, CreatedAt, ExpiresAt, LastSentAt |
| CustomerOtpRateLimit | TenantId, Scope, ScopeDigest, WindowStart, Count, LastAttemptAt; unique scope/window |
| CustomerSession | TokenDigest PK, TenantId, CustomerId, VerificationMethod, VerifiedAt, CreatedAt, ExpiresAt, RevokedAt, LastUsedAt |
| CustomerAuthAudit | EventId, TenantId, EventType, Status, Date, HMAC identifiers; no code, raw phone, token or secrets |

**Important:** there is no database migration in this sprint. Any implementation must follow staging \`last132_agent\` and protected migration control; no production \`last132\` access. For SaaS tenant scope, verify actual FK/keys in Casher before creating these tables.

## API/BFF contract to implement later

Website (\`cutsaloon.com\`) should own browser-facing authentication and host-only cookie; Casher (\`ops.cutsaloon.com\`) remains API/ledger authority.

Proposed flow:
1. Customer starts sign-in on website, submits E.164 phone via server-side form, receives generic acknowledgment (not customer-existence disclosure).
2. Website BFF calls trusted Casher challenge service after CSRF/Origin and rate limiting; provider sends OTP out-of-band.
3. BFF sends entered code to Casher in a protected server-to-server call; Casher atomically consumes OTP and resolves unambiguous customer subject.
4. Browser gets an **opaque revocable** session cookie on the website after verified assertion/identity, not the legacy POS cookie. Verify session on every private request, no-store on all member data.
5. Casher private ledger APIs accept only trusted website delegation and enforce customer+tenant ownership. Do not expose legacy ID-based URLs as member APIs.
6. Offer session revocation/logout, abuse detection, retries/backoff and monitoring; prove duplicate shared-phone behavior in staging.

A server-to-server assertion from predecessor PR #251 **may** be useful but its security semantics are not approved: identify issuer/audience, lifetime, replay protection, authorized tenant, and when session is revoked. Do not implicitly use it as a customer browser session.

## Tests and gates

\`src/lib/__tests__/cutClubOtpDomain.test.ts\` tests creation, secret checks, TTL, one-time consume, lockout after 5 wrong attempts, replacement and provider failure invalidation, tenant mismatch, duplicate/shared phone rejection, session token randomness and revoked/expired/foreign record denial.

**No HTTP/server test can honestly pass yet**: no login route or persistence/transport adapter exists. Test suite verifies deterministic pure logic, not durable concurrency/rate limits. CI must run the dedicated test and a production build; independent security review is required.

## Rollout plan

- **B1 (this PR)**: provider-neutral domain helpers + docs + offline unit tests. No execution on real customers.
- **B2 (new scoped issue)**: select approved delivery provider and costs, implement durable challenge/rate-limit/session repository via guarded staging migration, test parallel sends and atomic replay.
- **B3 (new scoped issue)**: secure website↔Casher BFF, session issuance and revocation behind feature flag default OFF. Test cookie CSRF/CORS.
- **B4 (new scoped issue)**: migrate private GETs and financially significant POSTs to authenticated subject and transaction-safe ownership; feature-flag, staging negative integration tests, legacy compatibility and rollback.
- **B5**: launch gated member dashboard/Wallet only after all prior security gates and explicit merge/production approval.

Do not mark the parent #243 as fixed or any /club login "live" after B1 alone.
