# CUT CLUB — Customer Security Sprint A

Source audit: Casher repository main inspected on 2026-11-14.
Parent security task: https://github.com/tarek-saad-dev/casher/issues/243
Implementation sprint: https://github.com/tarek-saad-dev/casher/issues/249

**Status:** Source-level observations and isolated verification foundation only.
**Not a production security fix.** No existing API, database, customer session,
or customer records are changed by this sprint.

## Observed public client endpoints

Routes below are relative to /api/public/client.

| Route | Methods | Risk classification | Source observation |
|---|---|---|---|
| loyalty/me | GET | Private customer identity, Coins, visits, tier | Caller-supplied clientId query; wildcard CORS |
| loyalty/activity | GET | Private point ledger/activity | Caller-supplied clientId query; wildcard CORS |
| loyalty/rewards | GET | Personal reward eligibility and balance | Caller-supplied clientId query; wildcard CORS |
| inventory | GET | Owned vouchers/inventory | Caller-supplied clientId query; wildcard CORS |
| inventory/[inventoryId] | GET | Individual voucher details and usage | Caller-supplied clientId query; wildcard CORS |
| store | GET | Item catalog plus personal balance/eligibility | Caller-supplied clientId query; wildcard CORS |
| store/items/[itemId] | GET | Item detail plus personal eligibility | Caller-supplied clientId query; wildcard CORS |
| store/buy | POST | Spends points, creates voucher | Caller-supplied clientId query; wildcard CORS; high priority |
| store/open-box | POST | Opens mystery box / changes entitlement | Caller-supplied clientId query; wildcard CORS; high priority |
| referral | GET | Generated referral code, user statistics | Caller-supplied clientId query; static placeholder stats |
| profile | POST | Returns basic customer identity from phone | Supplied phone in body; source requires verification of authorization and rate limits |
| packages | GET | Public packages catalog | Catalog tenant resolution; should remain public subject to tenant audit |
| packages/[id] | GET | Public package details | Catalog tenant resolution; should remain public subject to tenant audit |

CORS is not authentication. A source-level concern is not a claim that an
endpoint is deployed, directly exposed or exploitable in production.
Routes outside /api/public/client also require separate review.

## Added by this sprint

- Node-only src/lib/cut-club/customerSession.ts provides a fail-closed HMAC
  **verifier** for future tokens issued only after trusted OTP verification.
- The signature covers subject customerId, tenantId, sessionId, issuance and
  expiry, OTP verification timestamp and a dedicated customer issuer/audience.
- No signing secret is committed or defaulted. Minimum server-only secret is
  32 bytes. POS employee sessions are a separate audience.
- Every protected resource needs an additional customer+tenant ownership check.
- Focused unit tests cover tampering, expiration, staff session rejection,
  cross-tenant denial and different client ID denial.

**The module cannot issue a session, send OTP, or authenticate a phone.**
No existing route calls it yet, so it does not cure the existing risks.

## Next security phases (blocked until design approved)

### Phase B — verified identity issuance

1. Choose an OTP provider, cost model, rate limits and privacy terms.
2. Server verifies the challenge (not simply a phone lookup) before deriving
   customer and tenant from trusted records, including ambiguous phone resolution.
3. Choose opaque revocable session storage vs short-lived signed customer
   sessions; document logout and revocation. Store only in Secure, HttpOnly,
   appropriately scoped customer-only cookies with CSRF controls.
4. Define the website BFF contract: server derives subject from verified
   cookie, never from URL clientId; all private responses are no-store.
5. Test stale/missing/tampered tokens, cross-account and cross-tenant queries,
   credential/cookie confusion, rate limiting, session fixation and rotation.

### Phase C — sensitive API rollout

1. Make buy and open-box operations impossible without authorization; add
   idempotency, audit trail and transactional ownership checks.
2. Migrate personal GETs to verified subject and enforce tenant boundaries on
   every underlying query. Preserve publicly safe packages/catalog endpoints.
3. Coordinate with existing legacy website and booking flows; no silent
   cutover that causes account lockouts. Feature flag or safe compatibility
   period and rollback required.
4. Run targeted tests, staging-only checks and independent security review;
   request owner approval before any merge/deployment.

## Required website contract

- Public https://cutsaloon.com/cut-club is indexable and has no customer data.
- Private https://cutsaloon.com/club and its child routes require authenticated
  customer-only sessions, noindex and no-store.
- Casher at ops.cutsaloon.com remains the single source of financial truth;
  staff POS sessions must never be accepted as CUT CLUB member sessions.
- Same-domain cookies and BFF forwarding must be reviewed for CSRF, CORS,
  SameSite and whether domains share session secrets (prefer independent
  verifier and no unnecessarily shared root-domain cookies).

## Release gates — NOT YET SATISFIED

- [ ] OTP provider and verified issuance exists
- [ ] Customer subject bound to authoritative tenant and account
- [ ] Every private read and write enforces ownership
- [ ] Revocation, CSRF, CORS/Origin and rate limits validated
- [ ] Existing website and booking migration tested
- [ ] CI, staging and security review passed on the exact PR head
- [ ] Explicit owner merge approval and production verification

No production customer data or credentials were accessed to produce this audit.
