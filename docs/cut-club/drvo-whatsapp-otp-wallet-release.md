# CUT CLUB — DRVO WhatsApp OTP → Verified Identity → Real Casher Wallet

**Status (19 Nov 2026): implementation in draft PR #322; NO SQL applied, NO public rollout.**
Website counterpart: cut-salon-rtl-booking PR #73. DRVO repo unchanged; tested upstream API is reused.

## Trust boundaries

Browser `cutsaloon.com` → same-origin Website BFF (only `/api/club/auth/*`) → Casher `ops.cutsaloon.com` BFF-only routes → DRVO paired server API (`app.drvotech.com`).

- DRVO's `inboundApiKey` is decrypted ONLY by Casher's existing `getDrvowaIntegrationConfig()`; Website NEVER receives it.
- Website and Casher use an **independent** 32+ byte `CUT_CLUB_BFF_SHARED_KEY` secret over HTTPS. No `NEXT_PUBLIC_` version.
- Website sets opaque host-only `HttpOnly`, `Secure` and `SameSite=Lax` cookies for pending verification and authenticated member session. Casher stores only digests, with an independent table from `pos_session`.
- The browser sends phone + purpose to start, and **only 6-digit code** to verify. Casher reads phone/purpose/challenge from the durable pending capability. `verified:true`, `clientId`, phone changes and cookie replay cannot assert ownership.
- DRVO is authoritative for 5-minute OTP expiry, 5 attempts, 60-second resend and durable rate limits, and consumes challenge once. Casher atomically leases pending verification, prevents concurrent local verify and persists expiry/revocation.
- `GET /api/public/cut-club/wallet` requires **both** the server-only BFF key and a non-revoked server-trusted member session; WHERE scopes every financial query by tenant and authorized legacy customer. `Cache-Control: no-store`.
- Old public phone/clientId GET and reward mutation routes are intentionally quarantined (nine routes). This impacts old loyalty clients; no compatibility bypass using legacy IDs should be re-added.

## Matching existing Casher customers

1. OTP verifies **control of a WhatsApp phone**, not ownership of every historical Casher record containing that phone.
2. Lookup legacy candidates in the configured CUT tenant only; normalize accepted `01...`, `+20...`, `0020...`, `20...` prefixes. Other tenants are never candidates.
3. Zero historical matches: create a new `CutClubMemberAccount` in Casher, **without creating a duplicate TblClient**. Session enters `UNLINKED`, showing no invented balance. At first verified visit staff may link to the newly created Casher record.
4. One or more unapproved historical matches: session enters `REVIEW_REQUIRED`. Balance, vouchers, movements, PII and member identity are unavailable.
5. Staff with admin privileges reviews identity **in person**, obtains the correct `ClientID` from protected Casher UI and approves under `/admin/cut-club/member-review`. The server independently re-checks tenant + normalized phone; a unique index forbids two member accounts bound to one legacy client. No blind auto-link.
6. Already staff-approved historical mapping: on the next OTP login, the server checks the record still uniquely matches the phone before issuing a normal `ACTIVE` session. Wallet API returns real `TblClientLoyalty.PointsBalance`, `TblClientInventory` and `TblLoyaltyPointLedger` rows. EGP promo-credit is deliberately NULL because a proven source is not yet available.

## Required settings

| Process | Setting | Requirements |
|---|---|---|
| Casher | `CUT_CLUB_MEMBER_WALLET_ENABLED` | `false` initially; `true` only after schema + security gates |
| Casher | `CUT_CLUB_AUTH_TENANT_ID` | UUID of the **verified** CUT Salon tenant, never request-supplied |
| Casher | `CUT_CLUB_BFF_SHARED_KEY` | Unique random 32+ byte secret shared with Website server only |
| Casher | `CUT_CLUB_CASHER_PUBLIC_ORIGIN` | `https://ops.cutsaloon.com` for admin CSRF guard |
| Website | `CUT_CLUB_CASHER_ORIGIN` | `https://ops.cutsaloon.com` |
| Website | `CUT_CLUB_BFF_SHARED_KEY` | Identical server-only BFF secret |
| Website | `CUT_CLUB_PUBLIC_ORIGIN` | `https://cutsaloon.com` |
| Casher | `DRVOWA_CONNECTOR_SECRET` and existing pairing | Already configured: reuse encrypted DRVO integration key, do not create a new browser key |
| DRVO | `OTP_HMAC_SECRET` | Already configured on DRVO; **never copy** to Casher or Website |

Do not commit .env files, keys, customer phones, OTP codes, session tokens or database credentials.

## Migration and release gates — NOT yet completed

- [ ] Confirm actual staging SQL `dbo.TblClient.TenantId` and unique tenant-to-client mapping; no assumptions or guessed FK.
- [ ] Check shared staging `last132_agent` tenant collisions; prefer isolated disposable SQL for cross-account fixtures.
- [ ] Review and approve `scripts/cut-club/sql/member-wallet-staging-schema.sql` using existing manifest-controlled migration system; the SQL **refuses production** and no migration was executed by this PR.
- [ ] Run real SQL tests: two tenants, two clients/one phone, unknown/new signup, staff approval, concurrent verify, expiry, idempotency, logout/revocation, cookie restore, and wrong or used OTP denial.
- [ ] Verify upstream DRVO sending on one authorized test number, no code leakage or logs and both purposes; do not send traffic to random customers.
- [ ] Security review all legacy public route closures and existing customer impact, especially store purchase and mystery box.
- [ ] Deploy Casher backend + reviewed schema and matching BFF configuration before Website; independently verify no unauthenticated financial GET or writes.
- [ ] Separate explicit approval for production database migration and public flag; merging to main alone must not activate wallet.
- [ ] Pilot with staff-approved test customer, verify own ledger vs another client's denied, then staged public rollout.

### Automated offline tests

`npx vitest run src/lib/__tests__/cutClubMemberOtp.test.ts src/lib/__tests__/cutClubLegacyPublicQuarantine.test.ts`

Dedicated action: `.github/workflows/cut-club-member-wallet.yml` (no DB access). These tests and a green build **do not replace live SQL tests**, DRVO actual authenticated calls or operator sign-off.

### Operational safety

Rollback: set `CUT_CLUB_MEMBER_WALLET_ENABLED=false` on Casher to disable new OTP/session reads and preserve all historic vouchers and Coins untouched; Website shows safe login error instead of fake balances. Do not delete/rollback member tables while valid sessions exist; revoke them through an approved plan. No purchase, voucher redemption, Coins deduction, Mystery Box open or changes to existing loyalty balance are performed by the new wallet feature.
