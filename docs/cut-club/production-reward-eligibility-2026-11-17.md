# CUT CLUB production: legacy reward redeemability and existing voucher rights

**Owner-operated read-only last132 query, 2026-11-17.** No Production SQL queries/writes performed from GitHub connector.

## Observed facts
- CASHER_BOOT (CUT Salon) tenant UUID: `413D433E-F36B-1410-8820-009EC495C7E1`; GLEEM=1, PH1GTEST=2 (active but not approved for client rollout), CAMP_CAESAR=3.
- Reward store items 15/16/17/18 are all `ItemType=FREE_SERVICE`, `IsActive=true`, `SalonID=NULL`, `UnlimitedStock=true`, `StockQuantity=NULL`, `MinTierID=1`, and crucially **`ServiceID=NULL`** and `ProductID=NULL`.
- Prices: Item 15=30 Coins, 16=50 Coins, 17=90 Coins, 18=220 Coins.
- Cut Salon voucher counts in `TblClientInventory`: **14 ACTIVE** and **60 USED**. These are existing customer entitlements and historical ledger events; DO NOT delete, expire, reissue, refund or alter without verified accounting and owner approval.
- `ExpiresAfterDays=NULL` on all four items; don't retroactively invent a voucher expiry without a reviewed policy.

## Critical pre-launch integration gap
New cashier V2 requires a `FREE_SERVICE` reward item with an authentic legacy `ServiceID` and zero-final-price matching service detail in the saved same-customer+same-branch sales invoice before marking voucher USED. All four active rewards have NO ServiceID and cannot be redeemed by that candidate. A voucher code/status being ACTIVE or a reward `IsActive=true` is **not evidence of redeemability**. Guessing `ServiceID` by item name, using `Value` as a service ID, or simply marking used would risk customer rights.

The draft reward purchase settlement previously required only price/stock/tier/IsActive. This branch now requires `ItemType=FREE_SERVICE` and `ServiceID` positive/safe-integer before any stock reservation, Coins debit, ledger insert or voucher creation. SQL reads `ItemType` and `ServiceID` under its transaction lock, so a stale frontend cannot bypass this. Missing service mapping, non-free types and invalid IDs are rejected. Required synthetic regression tests confirm **zero Coins spent / no vouchers minted** in these scenarios.

## Additional operator read-only evidence needed
1. Non-personal item `ItemID, NameAr, NameEn, ItemType, ServiceID, Value, PriceCoins, IsActive` for each reward, business approval of what it provides and its permitted branches.
2. Aggregated inventory counts per ItemID and Status; separate USED linked to UsedInvID (nonnull) vs null, and usage-log action totals, without voucher codes or customer identifiers.
3. Actual legacy service identities and invoice lifecycle / price-final columns, verified by separate operator-run queries before any corrections.
4. Reconcile 14 ACTIVE and 60 USED historical vouchers, refunds and double-use risk in an isolated copy; never live-update those 74 customer entitlements as part of an exploratory step.

## Launch restrictions
- All wallet purchase, cashback, vouchers, cashier redemption and WhatsApp OTP flags stay OFF; no live customer BFF/cookie yet.
- Do not merge any stacked Casher PR into main: the repository automatically deploys to the VPS and old routes are quarantined before coordinated website compatibility release.
- After read-only inspection, create staging snapshot (sanitized customers) and reviewed service mapping plus **actual** SQL two-connection E2E before the first new voucher can be purchased or redeemed.
- Exclude PH1GTEST, DRVO_DEMO and unreviewed branch/item global policies.

**Status: NO-GO for financial launch; source-level fail-closed hardening only.**

## Further owner-operated read-only evidence: 14 active / 60 used breakdown

All existing reward items have `Value=NULL`, `ServiceID=NULL`. Their registered labels (not verified service IDs):
| ItemID | NameAr | NameEn | Coins | ACTIVE | USED |
|---|---|---|---:|---:|---:|
| 15 | ماسك وجه | Face Mask | 30 | 4 | 17 |
| 16 | حمام زيت | Hair Oil Treatment | 50 | 4 | 14 |
| 17 | Basic SkinCare | Basic SkinCare | 90 | 4 | 23 |
| 18 | Hair Cut | Hair Cut | 220 | 2 | 6 |

Owner's read-only `TblClientInventory` aggregates showed `UsedInvID IS NULL` for ALL 60 historical `USED` records, plus all 14 `ACTIVE` (expected). `TblInventoryUsageLog` contains exactly 60 `ActionType='USED'` records across this tenant. The **separate** `TblInventoryUsageLog.InvID` and `BookingID` columns were not checked yet and may contain linkage evidence; do not claim there is no invoice/booking linkage until the next aggregate query.

### Operator next: discover actual service IDs and log linkage, READ ONLY
- Verify `dbo.TblPro` columns `ProID`, `TenantId`, `ProName`, `ProNameAr`, `SPrice1`, `isDeleted` from Casher service catalog. Fetch only matching service candidate IDs/names/prices under the CASHER_BOOT tenant. These are **candidate matches only**; the owner must approve exact entitlements and single service mapping per reward.
- Group legacy usage log `InvID` and `BookingID` presence by `ci.ItemID`; count duplicate usage logs per `InventoryID`. Aggregate only, no phones/customer names/voucher codes.
- Inspect invoice-header metadata for cancellation/reversal and date/settlement columns before enabling same-invoice verification. An old invoice or cancelled invoice is NOT valid redemption proof.
- No repair/updates to the 74 customer entitlements, no settlement, no publication until staging 2-branch test and acceptance.
