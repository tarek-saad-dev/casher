# CUT CLUB 2.0 — legacy account-private GET quarantine
Issue [#274](https://github.com/tarek-saad-dev/casher/issues/274) · Parent [#243](https://github.com/tarek-saad-dev/casher/issues/243) · Source audit [#269](https://github.com/tarek-saad-dev/casher/issues/269).

## Why
Eight legacy customer GET APIs used request-controlled `clientId` for sensitive data. Some also had wildcard CORS. This is **source-level risk**, not proof that the routes are deployed or currently exploited. CORS, staff `pos_session`, a phone number, a front-end hidden button or a URL parameter are not customer authentication.

## Exact Draft behavior
The following GET and OPTIONS return generic HTTP 403 with `Cache-Control: private, no-store` and **no permissive CORS**, before parsing any request or fetching anything:

- `/api/public/client/loyalty/me` (name/phone/visits/points)
- `/api/public/client/loyalty/activity` (ledger)
- `/api/public/client/loyalty/rewards` (personal eligibility)
- `/api/public/client/inventory` (owned vouchers)
- `/api/public/client/inventory/[inventoryId]` (voucher/usage details)
- `/api/public/client/referral` (identity-derived referral)
- `/api/public/client/store` (catalog **combined with private balance/eligibility**)
- `/api/public/client/store/items/[itemId]` (catalog detail **combined with personalized status**)

The routes no longer import DB/ledger/store/inventory service code. Request body, URL clientId, staff cookie, bearer token, environment flag and item ID cannot re-enable the legacy endpoints.

**Unchanged:** `/api/public/client/packages` and `/packages/[id]` public catalogs; booking, invoice, POS/staff flows and all existing Coins, vouchers, ledger and customer records. Existing `POST /api/public/client/profile`, `GET /api/client/lookup` and `PATCH /api/client/update` are *separate* risk surfaces; tracked in #269 and [#272](https://github.com/tarek-saad-dev/casher/issues/272). Old buy/open-box and redeem writes are separately drafted in [#266](https://github.com/tarek-saad-dev/casher/pull/266) and [#271](https://github.com/tarek-saad-dev/casher/pull/271).

## Impact before release (stop/go gates)
- Old `/client/loyalty` used several of these private reads. Website [Draft #51](https://github.com/tarek-saad-dev/cut-salon-rtl-booking/pull/51) replaces that page with a no-personal-fetch maintenance state. [Draft #53](https://github.com/tarek-saad-dev/cut-salon-rtl-booking/pull/53) similarly retires unverified phone-only `/client`.
- Do not merge this backend PR by itself: it would disable customer GETs while the old website may still call them. All production releases require **separate exact-head owner approval** and a coordination window after VPS rollback/readiness evidence.
- Preserve historical balances, outstanding vouchers and staff support. Confirm lawful service of pre-existing entitlements without restoring anonymous APIs. Do not move or reset customer data in this patch.
- Public Store marketing catalog must be implemented as a **new intentionally anonymous, non-personal endpoint** (or existing reviewed catalog) rather than reopening clientId-based `store`.
- A new secured member endpoint must derive tenant/customer from a revocable customer session, validate ownership of every inventory/voucher record at the data source and enforce no-store/CSRF policies. Follow auth Sprint A [#251](https://github.com/tarek-saad-dev/casher/pull/251), offline OTP domain [#256](https://github.com/tarek-saad-dev/casher/pull/256) and durable persistence [#257](https://github.com/tarek-saad-dev/casher/issues/257) before wiring real Wallet data.

## Test evidence required
- [ ] Exact-head CI targeted Vitest GET/OPTIONS deny behavior and source dependency checks
- [ ] Independent security review and CORS/cache/header validation
- [ ] Staging-only negative requests for fake IDs, alternate customer, alternate tenant, forged cookies, and arbitrary inventory ID; **zero personal data** and no DB mutation
- [ ] Booking and POS smoke separately to verify unaffected services
- [ ] Website compatibility + support communications + old deep links assessed
- [ ] Safe VPS build/rollback evidence (website issue #26); no live Coins/PII tests
- [ ] Specific human merge approval for each PR, then read-only post-deploy checks

**Current state: DRAFT / NOT DEPLOYED. No read of production or staging customer rows, no OTP sent, no account mutation.**
