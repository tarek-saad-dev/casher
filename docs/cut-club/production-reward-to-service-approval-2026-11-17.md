# CUT CLUB — real last132 reward → Casher service approvals (2026-11-17)

**Source:** owner-operated READ-ONLY production `last132` report pasted in conversation. No customer names, phone numbers, voucher codes or private account values are required to review this mapping. No production SQL DML/DDL, backups, migrations, merges, deployments or WhatsApp sends were executed by this work.

## Verified observations — do NOT guess from name match

| Existing reward | ItemID | Coins | ACTIVE | USED | Candidate active TblPro service(s) | Approval status |
|---|---:|---:|---:|---:|---|---|
| ماسك وجه / Face Mask | 15 | 30 | 4 | 17 | Face Mask — **ProID 39**, price 50 EGP; **Care Mask ProID 2092** is a different 50 EGP service and must not be substituted without owner decision | **PENDING explicit owner selection** |
| حمام زيت / Hair Oil Treatment | 16 | 50 | 4 | 14 | Hair Oil Treatment — **ProID 22**, price 120 EGP; Advanced Hair Oil Treatment **ProID 1090**, price 200 EGP is a different service | **PENDING** |
| Basic SkinCare | 17 | 90 | 4 | 23 | **ProID 11** Fresh Skin Care / تنظيف بشرة عادي, price 200 EGP **OR ProID 29** Classic Skin Care / تنظيف بشرة كلاسيكي, price 300 EGP. *Cannot infer from label.* | **BLOCKED — ambiguous** |
| Hair Cut | 18 | 220 | 2 | 6 | Active Hair Cut / حلاقة شعر **ProID 9**, price 200 EGP. The other Hair Cut **ProID 1053** is deleted; must never select the deleted duplicate. | **PENDING** |

All four reward rows: `ItemType=FREE_SERVICE`, `IsActive=true`, `ServiceID=NULL`, `Value=NULL`, `SalonID=NULL`, `MinTierID=1`, `UnlimitedStock=true`, `ExpiresAfterDays=NULL`.

**Existing entitlements: 14 ACTIVE + 60 USED = 74 total.** All 60 USED have `UsedInvID=NULL`; further read-only query returned `TblInventoryUsageLog.ActionType='USED'`: 60 log rows representing 60 different inventory IDs, **0 linked `InvID`, 0 linked `BookingID`**. Existing logs are evidence that the legacy application recorded use, **not proof of completed sale or service delivery**. Never fabricate retroactive invoice associations or mark ACTIVE vouchers used just to backfill.

`TblinvServHead` lifecycle-like columns found in metadata: `invDate` and `ReservDate` only, no obvious Status/Cancelled/Paid columns. Further authoritative cancellation/reversal accounting must be inspected before treating an invoice as settled.

## Draft safeguards added now

- **Server-only explicit mapping:** `src/lib/cut-club/reviewedServiceEntitlements.ts`, `CUT_CLUB_REVIEWED_REWARD_SERVICE_MAP_JSON` is unset by default, and checks strict Tenant UUID + ItemID, ServiceID and missing/duplicate/invalid mappings. It does **not** infer based on name, Coins price or deleted duplicate services. This env value is NOT configured on VPS and none of the candidate mappings is approved automatically.
- **Tenant-owned live service verification:** in the candidate cashier V2 read+use path, the approved ServiceID must also be backed by `dbo.TblPro(ProID, TenantId, isDeleted=0)`, and the original DB reward ServiceID, if populated, must match the reviewed mapping. No blind inference when NULL.
- **Voucher-specific financial proof:** a saved zero-priced service line is insufficient (could be a manual complimentary service). Candidate redemption now requires a **specific** invoice claim for TenantId+InventoryID+ClientID+BranchID+InvID+ServiceID in `dbo.CutClubVoucherInvoiceClaim`, status `APPLIED`, before marking USED. This table does not yet exist on production; the query intentionally fails CLOSED, even if someone accidentally enables redemption flags. The invoice create hook that writes/reverses claims atomically is **NOT implemented**; it must be reviewed, built and tested before go-live. Draft staging-only guarded DDL is at `docs/cut-club/sql/cashier-invoice-claim-staging-only.sql`. **DO NOT run DDL on last132.**
- Neither this approval config nor a claim row substitutes for verified customer WhatsApp OTP + Wallet/BFF and safe actual invoice cancellation/refund reconciliation. All CUT CLUB flags stay OFF until the complete program meets security and financial acceptance.

## Required business decisions and next steps

1. Owner explicitly approves correct actual services for 15/16/17/18, particularly **Basic SkinCare: Fresh Skin Care (11) or Classic Skin Care (29)**; the other three candidate IDs must be separately accepted too.
2. Confirm offering scope in Gleem/Camp Caesar for each reward and how already ACTIVE customer entitlements are honored if a service changed since purchase. PH1GTEST remains excluded from any customer/cashier public rollout.
3. Implement atomic voucher claim within the saved POS invoice transaction and explicit REVERSED handling on cancellation/refund; protect repeat submissions and duplicate claims, make invoice ledger reconcile with Coins. Run staged two-device/concurrent E2E on actual SQL semantics and fake customer data first.
4. Complete real customer OTP transport + durable revocable session + secure Website BFF and tenant-owned Wallet. Current website /club HTTP404, not live.
5. Obtain explicit exact-head owner launch approval after joint website+cashier/branch tests, backup/rollback and reconciliation. No automatic merge — Casher main triggers VPS deploy.

**Release decision: NO-GO / code Draft only** until owner approvals and staging financial proof. 
