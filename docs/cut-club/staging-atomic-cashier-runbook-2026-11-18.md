# CUT CLUB — owner-approved services and invoice-atomic POS staging rollout

**18 November 2026, status: SOURCE IMPLEMENTED / STAGING EXECUTION NOT YET PROVEN / PRODUCTION NO-GO.**

This Draft branch is stacked on Casher #317. No Production `last132` SQL DML/DDL, migration, merge, deployment, message delivery, Coins debit, or voucher modification has occurred. The operator must independently prepare a **separate isolated staging app + database**; NEVER configure the production Casher app at `/home/casher/app` to use staging or set staging flags there.

## Owner-approved reward → live service identity

| Reward ItemID | Name | Coins | Owner-approved Casher TblPro.ProID |
|---|---|---:|---:|
| 15 | ماسك وجه / Face Mask | 30 | **39** |
| 16 | حمام زيت / Hair Oil Treatment | 50 | **22** |
| 17 | Basic SkinCare (Fresh Skin Care) | 90 | **11** |
| 18 | Hair Cut | 220 | **9** |

These values were explicitly approved in conversation by the salon owner; they are pinned to the CASHER_BOOT tenant UUID `413d433e-f36b-1410-8820-009ec495c7e1` in the staging sale hook. **No Production row update** to `TblLoyaltyStoreItem.ServiceID` was done. Database loyalty rewards remain `ServiceID=NULL`; the verified mapping seam explicitly handles that with separate tenant+item approval. Invalid/deleted/cross-tenant service is refused.

The owner also supplied read-only Production counts: **14 ACTIVE** vouchers and **60 USED**, the latter with no invoice/booking linkage in both `TblClientInventory.UsedInvID` and `TblInventoryUsageLog.InvID/BookingID`. These are historical client entitlements and are NOT re-seeded, overwritten, expired, or backfilled in this work.

## Atomic behavior implemented in this candidate

1. **POS UI** `/income/pos` checks authenticated `GET /api/pos/cut-club/staging-mode`. Voucher input appears only if staged DB `last132_agent`, SQL login `drvo_agent`, staging schema and explicit allowlist were independently verified by the *server*. Client must be selected; invoice must be new, not an edit. POS staff enters/scans voucher code, adds actual matching service with its regular original price and one unit, and applies a full **line discount** so saved `SPriceAfterDis=0`. The standard save action submits `cutClubVoucherCode` in `POST /api/sales`.
2. **Both sale create implementations**, legacy `src/lib/sales/legacyRouteSaleCreate.ts` and port-backed `src/apps/pos/internal/legacySaleCreateAdapter.ts`, call `stageVoucherOnNewSale` before SQL transaction `COMMIT`. This checks authenticated tenant+branch, exact SQL staging connection, owner-approved item+service, active same-tenant `TblPro`, globally scoped reward, unique ACTIVE single-quantity client-owned voucher, expiry and one saved positive-original-price/zero-final-price service line. It then inserts unique `CutClubVoucherInvoiceClaim(APPLIED)`, transitions this voucher ACTIVE→USED with the actual saved invoice ID and inserts one legacy usage log. Any SQL exception or failed predicate **rolls back the entire invoice + payment + voucher claim + voucher status/log**.
3. **Invoice edits:** the existing audited PUT path now refuses an invoice containing an APPLIED staging claim. Cashier must cancel/reissue until a complete refund/recalculation model is separately approved. This protects service/price changes after the claim.
4. **Invoice deletion:** the audited DELETE path calls `reverseStagingClaimBeforeSaleDeletion` inside the SAME transaction. A legitimate APPLIED staged claim restores exactly one voucher USED→ACTIVE (UsedAt and UsedInvID cleared), then stamps claim REVERSED with timestamp. The historical USED usage log remains immutable; reversed claim records restore the effective entitlement. Invoice+stock+treasury deletion and voucher restoration commit together or roll back together. If the staging flag was turned OFF while a claim is active, deletion fails closed rather than silently orphaning it.
5. **No-double-claim:** staging SQL has unique **filtered** indexes over APPLIED claims, one per inventory and one per branch/invoice/service. REVERSED claims remain historical but do not block reuse after a legitimate invoice cancellation. Do not reuse the same service twice within a single invoice; use a reviewed line-level model first.
6. **Normal POS sales with no voucher code remain untouched**: hook returns immediately. Client-facing Wallet/OTP and Coins-purchase routes are not enabled or covered by this staging POS work.

## Required separate staging setup (NOT executed by ChatGPT)

Before creating any staging table, confirm independently:
- Separate app checkout/service from production; its environment targets **only** SQL Server database `last132_agent` using SQL login **`drvo_agent`**. The stage tenant/client/voucher data must be synthetic/anonymized; never copy customer PII and WhatsApp channels from Production into an accessible staging environment.
- Existing stage schema matches `TblClient`, `TblPro`, `TblClientInventory`, `TblLoyaltyStoreItem`, `TblinvServHead/Detail/Payment`, `TblInventoryUsageLog`; staged CASHER_BOOT Tenant UUID/branch IDs are reviewed. Branch 2 PH1GTEST and demo branches 8/9 are prohibited from real-customer rollout.
- DBA reviews `docs/cut-club/sql/cashier-invoice-claim-staging-only.sql`: guarded `DB_NAME()='last132_agent'` and `SUSER_SNAME()='drvo_agent'`, creates claim table and filtered unique indexes, **no customers/Coins writes**. Apply it **only** on the staging DB, after taking a staging snapshot and reviewing permissions. Existing claim table causes fail-closed, not automatic destructive migration.
- Use `node scripts/cut-club/staging-atomic-claim-preflight.cjs` in the **staging checkout only**; it is read-only and checks connection, exact SQL login, claim metadata and four active service IDs (9/11/22/39). A successful result is *metadata readiness*, not tested transaction semantics.

### Explicit staging-only environment variables

Configure **only** in isolated staging app, after SQL DBA review:
```dotenv
LOCAL_DB_NAME=last132_agent
CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED=true
CUT_CLUB_STAGING_APPROVED_BRANCHES_JSON=["413d433e-f36b-1410-8820-009ec495c7e1:1","413d433e-f36b-1410-8820-009ec495c7e1:3"]
CUT_CLUB_REVIEWED_REWARD_SERVICE_MAP_JSON={"413d433e-f36b-1410-8820-009ec495c7e1:15":39,"413d433e-f36b-1410-8820-009ec495c7e1:16":22,"413d433e-f36b-1410-8820-009ec495c7e1:17":11,"413d433e-f36b-1410-8820-009ec495c7e1:18":9}
```
`CASHER_CANONICAL_ORIGIN` should point to the isolated staging origin. Leave `CUT_CLUB_CASHIER_V2_REDEEM_ENABLED`, public Wallet, purchases and WhatsApp OTP flags OFF; the invoice claim flow itself consumes the voucher atomically, so the post-invoice redeem API is not required.

**Do not use these values in Production, do not modify `/home/casher/app` or its `.env`.** The staging-only flag is opt-in; absence = no redemption writes.

## Acceptance matrix to run on ACTUAL staging SQL with synthetic customers

- **Happy path:** one active synthetic voucher #17 (Basic SkinCare→ProID 11), positive original price, Qty=1, net=0, saved sales invoice same customer+GLEEM branch; exactly 1 APPLIED claim, 1 USED voucher linked to saved InvID, 1 usage log, payment row and invoice details committed.
- **Wrong account/tenant/branch:** never reveal or use voucher; PH1GTEST=2 and DRVO_DEMO=8/9 denied; rollback full invoice on voucher code/owner/branch mismatch.
- **Bad entitlement/benefit:** USED, expired, quantity>1, deleted or foreign ProID, incorrect service ProID, Qty>1, SPrice=0, nonzero final line price, duplicate matching lines all rollback invoice and voucher state without partial cash/loyalty effects.
- **Concurrent two cashiers same code:** one commit only; second fails without a second charged invoice; no double claim/usage.
- **Network failure/retry:** if client retries after an unknown response and first sale committed, voucher duplicate attempt must not create a second applied claim; reconciliation finds the first invoice, avoid cashier double billing.
- **Edit:** claimed invoice PUT refused until reviewed cancellation/reissue, no client price or voucher changes.
- **Cancel:** audited DELETE transaction reverses APPLIED claim and restores voucher before invoice deletion; history remains, no stale USED voucher. Repeat cancellation or failed deletion cannot double-restore.
- **Reissue:** after cancellation the SAME synthetic voucher may be applied to a new, correctly proven invoice using unique filtered APPLIED indexes, original REVERSED row retained. Any subsequent refund/cancellation must preserve ledger accounting.

### Rollback rule

Do not delete/rename staging claim table while an APPLIED claim exists. Stop new staged claims by turning off the staging feature flag. Under flag OFF, audited deletion of a claimed staging invoice is deliberately blocked until manually reviewed controlled reversal is allowed. Review `CutClubVoucherInvoiceClaim` vs inventory and invoice balances before removing staging data. Revert staged app checkout to previous commit after staged claims are fully reconciled.

## Remaining production-release blockers

Full client verified WhatsApp OTP + opaque session + website BFF; all production reward purchase and voucher financial gates; actual SQL staged commit/rollback evidence, concurrency and cancellation acceptance; historical rights handling for 14 ACTIVE + 60 USED; branch devices and printed receipt; independent security review; production backup/rollback and explicit owner exact-head go/no-go. Casher `main` automatically triggers VPS deploy: **all PRs remain Draft/unmerged**.

**No staging SQL command has been executed using connected GitHub tools.** CI is synthetic and a production build, not live staging E2E.
