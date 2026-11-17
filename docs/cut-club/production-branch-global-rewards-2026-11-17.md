# CUT CLUB — last132 production branch/global reward evidence (2026-11-17)

**Owner-operated READ-ONLY SQL, provided in this conversation. No SQL was executed by GitHub tools. No merges/deploys/mutations.**

## Actual observed database schema/data
- Database: `last132`, production VPS local SQL Server. This is **NOT** the review-only staging DB `last132_agent`.
- Active tenant `CASHER_BOOT`: `413D433E-F36B-1410-8820-009EC495C7E1`:
  - `GLEEM` legacy BranchID **1** (active)
  - `PH1GTEST` legacy BranchID **2** (active **test branch: do not allow CUT CLUB customer/cashier rollout**)
  - `CAMP_CAESAR` legacy BranchID **3** (active)
- Separate active tenant `DRVO_DEMO`: `18CB423E-F36B-1410-8822-009EC495C7E1`, demo branch IDs **8/9**, explicitly NOT customer rollout.
- `TblLoyaltyStoreItem`: **4 rows**, all `SalonID IS NULL`, none branch-specific in this *field*. This is NOT approval to advertise/redeem them without business terms, owner, tenant, price and active state audit.
- `LegacyIdMap`: entity types `branch` (5 rows) and `staff_user` (20 rows). No customer mapping type observed; DO NOT derive tenant->customer from these records.
- Existing required legacy loyalty, customer, voucher, invoice and ledger table checks were marked OK in a prior metadata query.

## Actual code corrections in this stacked Draft
1. `cashierProductionBranchPolicy.ts`: a **server-operator-defined allowlist** for tenant UUID + BranchID. Default OFF. Status `active` alone cannot grant customer POS wallet access. Example only for owner approval:
   `CUT_CLUB_CASHIER_APPROVED_BRANCHES_JSON='["413d433e-f36b-1410-8820-009ec495c7e1:1","413d433e-f36b-1410-8820-009ec495c7e1:3"]'`
   **Do not set this yet**, and never add PH1GTEST or DRVO_DEMO without a reviewed separate launch request.
2. The old positive `CUT_CLUB_POS_LEGACY_SALON_MAP_JSON` requirement was a false blocker for all current NULL-SalonID items. New staff routes now require BOTH operable branch and the explicit release allowlist. If no trusted numeric SalonID mapping exists, it is **null**, and SQL permits **only** items with `si.SalonID IS NULL`. If a verified map is later configured, SQL additionally permits `si.SalonID=@legacySalonId`. It NEVER substitutes BranchID as SalonID and NEVER widens to other numeric SalonIDs.
3. POS item list uses explicit `legacySalonId=null` as a safe filter (only globally scoped items). `undefined` preserves the original internal service default for other callers, but all gated staff routes supply an explicit value. Cross-tenant client identity and staff operability checks are unchanged.
4. New unit/source gate tests cover 1+3 allowed only by explicit operator JSON, active test branch 2 denied, DRVO_DEMO 8/9 denied, missing/invalid allowlist denied, and no numeric SalonID bypass. Mandatory CI.

## Still required before any feature flags are enabled
- Read-only verify item `ItemType`, `IsActive`, price/stock/tier/expiry and actual store-sharing policy; NULL SalonID means no numeric branch tie, not necessarily legal/commercial applicability to other tenants.
- Confirm authoritative `TblClient.TenantId`, matched verified WhatsApp identity and loyalty, plus service invoice line key and tenant/branch ownership. Current client login remains closed until fully verified.
- Two-connection SQL Server staging financial test (same-voice voucher retry, FAILED rollback, cancellation/refund, discount), legacy usage log and old sale ledger reconciliation, per-device cashier E2E.
- Ensure `CASHER_CANONICAL_ORIGIN`, two independent flags and safe default values; no production cutover without independent review and explicit owner go/no-go. No automatic Merge: Casher main triggers VPS deploy.
- No staged migration or production SQL DML has been performed by this PR.

**Status: Draft/NO-GO.**