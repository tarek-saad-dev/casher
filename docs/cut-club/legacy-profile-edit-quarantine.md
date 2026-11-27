# CUT CLUB 2.0 — unauthenticated legacy profile update quarantine (#272)

## Scope / source finding
`PATCH /api/client/update` previously accepted JSON body `clientId` and editable profile fields and called `updateClientWebsiteProfile(tenantId,{clientId,...})` without proof of customer ownership. Rate limits and public tenant/catalog resolution are not verified customer identity. This is a **source-level** risk; current production exploitability/traffic are not independently verified.

The draft candidate makes PATCH and OPTIONS always respond with a generic HTTP 403, `private, no-store`, no permissive CORS. It has no import/call into profile editing or DB services and cannot be re-enabled by header, staff cookie, request body or environment flag.

## Do NOT infer these are safe
- Separate `GET /api/client/lookup?mobile=...` still returns customer profile fields based on unverified phone and may have independent booking/compatibility consumers. **Not changed by this PR.**
- `POST /api/public/client/profile` and GET membership/inventory personal APIs remain independently tracked by [#269](https://github.com/tarek-saad-dev/casher/issues/269).
- Website [Draft #53](https://github.com/tarek-saad-dev/cut-salon-rtl-booking/pull/53) replaces the old unverified /client login/editor; legacy page retirement alone is not backend authorization.

## Release gates
- [ ] Exact-head CI/build and independent review
- [ ] Non-production synthetic tests: PATCH/OPTIONS 403 with arbitrary client ID, staff cookie or forged JWT; no database/profile writes
- [ ] Inventory other profile editing entrypoints, including any operational workflows which require a secure replacement
- [ ] Keep public /book, booking status, staff POS, cashier workflows and public catalog functioning
- [ ] Agree staff procedure for legitimate customer corrections during temporary maintenance
- [ ] Coordinate website route retirement, Casher GET privacy fixes, verified customer OTP/session and VPS safe deployment
- [ ] Separate explicit owner approval before merge/deploy and before adopting any rollback that re-opens unauthenticated editing

The owner approved retiring legacy CUT CLUB customer-facing flows in principle on 2026-11-14. **No PR merge/deployment, real customer data lookup/mutation, OTP send or production DB change was authorized or performed here.**
