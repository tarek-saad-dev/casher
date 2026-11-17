# CUT CLUB 2.0 — Casher combined security/auth candidate (#293)

Integration compose date: 2026-11-15. This is a **code integration/rehearsal only**, not a deployed, financially usable loyalty system.

## Source bundles included (exact blob copies)
| Source PR | What it contributes | Live use now? |
|---|---|---|
| #251 | Verified customer assertion predicate and cross-tenant/record checks (offline only) | NO |
| #256 | OTP attempt/one-time-consume and opaque session domain primitives, fake CAS tests | NO delivery, session DB or login |
| #259 | Guarded staging schema metadata-only SQL generator/offline fixture tester | NO DB query, migration or OTP |
| #266 | Fail-closed legacy buy/open-box writes | DRAFT, not deployed |
| #271 | Fail-closed legacy redeem | DRAFT, not deployed |
| #273 | Fail-closed legacy unauthenticated profile update | DRAFT, not deployed |
| #275 | Fail-closed eight private `GET /api/public/client` routes | DRAFT, not deployed |
| #277 | Strictly public browse-only reward catalog DTO, no HTTP route | DRAFT, not deployed |
| #279 | Fail-closed two phone-only profile lookups | DRAFT, not deployed |

39 distinct files copied from original source branches; no shared file changes aside from `.github/workflows/ci.yml`, which was explicitly consolidated into a mandatory combined negative-test step and an offline metadata-only staging preflight test. **Original PRs remain unmerged.**

## Known critical blockers
1. **OTP delivery/provider:** no configured provider, cost or send limiter. Never send an OTP or issue customer auth from phone lookup until durable rate limits are implemented.
2. **Durable identity/session:** B1 pure functions are not SQL CAS, no authority-approved tenant-to-legacy customer mapping, no uniqueness/duplicate-phone recovery, no actual session persistence/revocation or migration. Do not mint a browser cookie yet.
3. **Secure private APIs:** eight anonymous GETs are quarantined, NOT replaced. New `/api/cut-club/v2` session-authorized read APIs and voucher ownership checks are necessary before any wallet.
4. **Financial settlement:** fail-closed old buy/redeem/open-box prevents insecure spend, but a new atomic transaction with balance/stock/ledger/idempotency, eligibility and tenant scope must be built/tested. No double spend and no negative points under concurrent requests.
5. **Compatibility:** Casher public `GET /api/client/lookup` and `POST /api/public/client/profile` are quarantined; booking clients outside /client must be checked first. Existing staff POS invoice, booking, print/attendance and secure voucher honoring must remain working.
6. **Security surface:** source scan is not an all-service production traffic audit. Check all call sites, external clients, reservations, cross-subdomain CORS/CSRF, cache and incident logging, and customer support.
7. **Rollout:** website [Draft #59](https://github.com/tarek-saad-dev/cut-salon-rtl-booking/pull/59) integrates public and safe private UI, legacy page retirement and synthetic preview; actual VPS #26 build/rollback and coordinated release remain unavailable.

## Required sign-off gates
- [ ] This combined exact-head CI tests + production build pass and independent code security review
- [ ] Synthetic 2-tenant/2-customer staging tests prove no cross-customer read/write and zero mutations from retired routes
- [ ] Verified ownership mapping, reusable checkout/account/booking integration and retention obligations
- [ ] Approval of OTP transport, rate limit, session TTL, durable staging schema + migration runner
- [ ] Verified operations: support handling for past vouchers, preservation of Coins ledger, monitoring and rollback
- [ ] Controlled website/backend release sequence, exact-head owner approval, no unreviewed PR or production merge

**NO merge to main, no production deploy, no staging or production SQL executed, no live customer data touched, no OTP or Coins mutation.**
