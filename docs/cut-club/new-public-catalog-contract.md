# CUT CLUB 2.0 — new public browsing catalog projection (#276)

## Why separate from old `store?clientId`
The old `/api/public/client/store` mixed all published rewards with account-private `balance`, `canAfford` and `remainingCoinsAfterPurchase` and depended on a caller-controlled `clientId`. Legacy privacy quarantine [Draft #275](https://github.com/tarek-saad-dev/casher/pull/275) disables that endpoint (and seven other private GETs) pending verified login.

## This Draft does
`src/lib/cut-club/publicRewardCatalog.ts` provides a pure offline, bounded projection from **already authorized, tenant-scoped active catalog rows** into a minimal browser-safe DTO:

```ts
{ mode: "browse_only", items: [
  { itemId, categoryId, nameAr, nameEn, priceCoins, featured,
    purchaseAvailable: false }
]}
```

It **never copies** clientId, tenantId, balance, inventory, voucher code, user tier, stock counts, internal service/product IDs or spend eligibility into output. Inactive/malformed/negative/fractional-price rows are omitted; duplicates are skipped and output is capped at 100. No network, DB, routing, OTP, account or financial calls occur.

## Source data and tenant isolation still BLOCKED
This is **not** a new live endpoint. Current `getAllStoreItems(salonId = null)` queries salon/global records, and the relationship between DRVO tenant UUID and legacy SalonID has not been verified in staging. Do not call this helper with results from an unscoped query and then claim tenant isolation. A later isolated issue must:
1. Prove trusted branch/tenant→salon catalog ownership in staging.
2. Select only expressly published public items for that tenant and verify prices/availability policy with operations.
3. Expose `GET /api/public/cut-club/catalog` **only after** source scope is proven, with no customer identity or mutation input and with cache/SEO review.
4. Keep `/club/wallet`, voucher history and account-specific eligibility exclusively behind verified revocable customer session and per-record authorization.
5. Use browse-only UI on public landing with honest maintenance text. Do not show functional purchase/box controls until secure backend is fully tested.

## Acceptance
- [ ] Exact-head CI/test + independent review
- [ ] No synthetic PII from poisoned test rows
- [ ] Source ownership validation from staging metadata and separate tenant isolation tests before any route
- [ ] Marketing labels/prices verified, booking/POS unaffected
- [ ] Separate owner release approval; NO merge/deploy from this Draft.

No account data read or changed, no database connection, no customer transaction, no OTP or production deployment.
