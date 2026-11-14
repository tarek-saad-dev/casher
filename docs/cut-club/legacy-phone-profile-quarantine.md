# CUT CLUB 2.0 — legacy phone-only profile lookup quarantine (#278)

## Source risk
`GET /api/client/lookup` previously returned a customer profile based on a request-supplied phone; `POST /api/public/client/profile` similarly queried by phone and returned name/phone/registration fields. Existing rate limiting or CORS policy cannot verify ownership of a phone. This is a **source** privacy/enumeration risk only; current production exploitability/traffic is unverified.

## Draft behavior
Both endpoints and their OPTIONS preflight always return a generic `403`, private/no-store, no permissive CORS, no body/query parsing or business/DB imports. No phone/caller existence can be distinguished. No staff cookie, bearer token or caller-controlled `clientId` can bypass.

**Explicit exclusions:** This PR does NOT touch `/book`, booking APIs, public package catalog, staff POS, customer DB, loyalty balances/vouchers, or separate profile `PATCH /api/client/update` [Draft #273](https://github.com/tarek-saad-dev/casher/pull/273).

## Critical customer-impact gate (NOT yet completed)
The old website `/client` phone-only login and profile editor are staged for retirement in [Website Draft #53](https://github.com/tarek-saad-dev/cut-salon-rtl-booking/pull/53). That alone does NOT prove other booking clients/apps do not call these two endpoints. Inventory all browser/mobile/third-party callers **before** any merge. Provide a guest booking fallback and staff process for customers needing profile edits. If legitimate booking relies on this API, migrate that caller to a narrowly scoped booking-safe response separately; do not restore anonymous full-profile access.

Real member lookups must be authorized with verified OTP, revocable customer session and server-derived tenant/customer ownership, under Casher [#243](https://github.com/tarek-saad-dev/casher/issues/243) and [#257](https://github.com/tarek-saad-dev/casher/issues/257). This PR does not implement or enable customer login.

## Go/no-go requirements
- [ ] Latest-head CI + build and independent privacy/security review
- [ ] Synthetic staging denied requests for varied phone/client IDs, no PII or DB access
- [ ] Booking/reschedule/POS compatibility verified via source and read-only/staging tests
- [ ] Website customer maintenance messaging, deep links and support procedure verified
- [ ] Historical balances, vouchers and existing bookings preserved
- [ ] Coordinated frontend/backend rollout with VPS/rollback evidence and separate owner approval

**DRAFT / NOT DEPLOYED.** No real profile lookup, OTP send, Coin/voucher change or customer DB mutation performed here.
