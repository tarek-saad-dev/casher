# CUT CLUB financial writes — C1 quarantine / customer-impact release gate

**Source issue:** [#264](https://github.com/tarek-saad-dev/casher/issues/264) · **Parent:** [#243](https://github.com/tarek-saad-dev/casher/issues/243)

## Security reason

The legacy public `POST /api/public/client/store/buy` and
`POST /api/public/client/store/open-box` had request-controlled
`clientId` without a proven customer-authenticated session. They can affect
CUT Coins, vouchers or entitlements. This is a **source-level risk**;
production exploitability or current traffic has not been independently
measured. Merely checking Origin, Referer, CORS or requiring staff
`pos_session` is NOT customer authorization.

## What this draft patch does

- Makes **both legacy POST endpoints and OPTIONS preflight** return
  `403`, an intentionally generic "verified customer sign-in required"
  message, `Cache-Control: private, no-store`, and **no permissive CORS**.
- Removes the unverified purchase and mystery-box handler paths from these
  routes. Store, balance and inventory services are not imported or invoked.
- No environment flag, clientId, body value, Authorization token, phone,
  test secret or staff cookie can reopen these write routes.
- The catalog GET routes and booking/checkout/POS routes are unchanged.
- New explicit regression tests and CI step verify deny behavior, privacy
  response headers, no CORS grant and absence of business mutation imports.

## **Product impact — STOP before merging**

If existing customer pages currently depend on buying store rewards or opening
mystery boxes through these URLs, merging this PR **will disable those
features**. The PR is intentionally DRAFT, **not safe to merge or deploy
without a customer-impact assessment**, support communications, fallback UI
and owner approval. Frontend apps should present a clear temporarily-unavailable
state, not silently retry or invent a purchase.

This is not the full security remediation: **all personal GETs, voucher
details and other financial routes still require the security parent #243**.
Do not claim CUT CLUB sessions or Wallet are live because this change blocks
two legacy endpoints.

## Release acceptance checklist (not yet complete)

- [ ] Audit real client usage of both legacy routes and current operational
      status without accessing or exporting personal information.
- [ ] Obtain business/security owner agreement on temporarily disabling
      loyalty purchases and mystery boxes; verify customers cannot lose Coins
      through the transition.
- [ ] Verify representative client pages show an honest unavailable message
      and preserve balances/entitlements.
- [ ] Independent code/security review, exact-head test/CI/build.
- [ ] Confirm real tenant-scoped customer identity/OTP and replacement write
      APIs with idempotency, balance checks, atomic ownership and double-spend
      tests before re-enabling the actions.
- [ ] Explicit human merge approval; merge deploys production immediately.
- [ ] Read-only post-deploy smoke: anonymous POST and OPTIONS return 403, no
      Coins/voucher mutations. Do not test against real customer balance.

## Rollback risk

Rolling back to the prior public identifier-only handlers could reopen the
security exposure. Prefer a reviewed customer-authenticated replacement or a
maintenance message; any rollback needs separate owner/security authorization.

**Not done:** no staging/production database read/write, no real purchase,
no login/OTP, no merge/deployment. Customer authentication remains blocked by
Casher #243, #256/#257, and website secure session/BFF plans.
