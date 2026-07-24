# Phase 1J Closure — Branch Inventory and Purchase Ownership

**Status:** Complete (schema migration + application integration + documentation)  
**Date:** 2026-07-24  
**Database:** cloud / `last132` only  
**Live active branches:** **1** (GLEEM) — unchanged  
**PH1GTEST:** inactive (`BranchID=2`) — unchanged  
**Sync:** stopped and unused  
**HR changes:** none

See also: `branch-phase-1j-inventory-dependency-audit.md`, `branch-phase-1j-product-tracking-contract.md`, `branch-phase-1j-schema.md`, `branch-phase-1j-stock-movement-contract.md`, `branch-phase-1j-purchases-and-returns.md`, `branch-phase-1j-pos-stock-integration.md`, `branch-phase-1j-transfer-contract.md`, `branch-phase-1j-migration-and-backfill.md`, `branch-phase-1j-verification.md`.

---

## 1. Executive verdict

| Decision | Verdict |
|---|---|
| GLEEM existing operations | **GO** — product stock now tracked in ledger; negative allowed by default for continuity |
| Branch inventory infrastructure | **GO** |
| Physical product sales in future branch #2 | **CONDITIONAL GO** — infra ready; recommend enforce non-negative + receive stock first |
| Purchase receiving in future branch #2 | **GO** — BranchID owned |
| Phase 1K Attendance | **May start** — inventory blocker cleared |
| Activate production branch #2 (full ops) | Still **NO-GO** until attendance + HR policies addressed |
| Reactivate PH1GTEST for production | **NO-GO** |
| Restart sync service | **NO-GO** |

**Single-line summary:** **GO** for GLEEM continuity and inventory infrastructure; **CONDITIONAL GO** for branch #2 retail until stock policy enforced; attendance unblocked for Phase 1K.

---

## 2. What Phase 1J delivered

### Schema (`add-branch-inventory-and-purchase-ownership.sql`)

* `TblBranchInventory` — branch-scoped balances  
* `TblInventoryMovement` — append-only ledger with idempotency  
* Purchase head: `BranchID NOT NULL`, `PostStatus` (default DRAFT), `ReturnOfPurchaseInvID`  
* `TblInventoryTransfer` + lines — schema only  
* GLEEM opening balances for **8** tracked products (`qtySum=0`)  
* `TblPro.Qty` deprecated via extended property — **no dual-write**

### Application

* `inventoryMutation.service.ts` — sole stock write entry  
* POS: sale create/update/delete stock integration  
* `GET/POST /api/inventory/branch` — list + manual adjust  
* `GET/POST /api/purchases` — branch-owned purchases with POST receipt  
* `INVENTORY_ALLOW_NEGATIVE_STOCK` defaults **true**  
* Concurrency: `UPDLOCK`+`HOLDLOCK`+`SERIALIZABLE`; unique `IdempotencyKey`

### Explicit exclusions

* `TblProMove` (49 rows) **not** imported  
* PH1GTEST receives **0** inventory rows  
* No transfer API  
* No HR / attendance changes  
* No second branch activation  

---

## 3. Live post-migration fingerprint

| Metric | Value |
|---|---:|
| GLEEM `TblBranchInventory` rows | 8 |
| GLEEM qtySum | 0 |
| PH1GTEST inventory rows | 0 |
| `TblInventoryMovement` rows | 0 |
| `TblinvPurchaseHead` rows | 0 |
| `TblProMove` rows | 49 (read-only) |
| Stock-tracked products | 8 |
| Service products | 36 |

---

## 4. Blocker delta vs Phase 1I

| Blocker (1I) | Phase 1J |
|---|---|
| Global stock on `TblPro.Qty` | **Cleared** — `TblBranchInventory` |
| Purchases lack BranchID | **Cleared** — NOT NULL + API |
| Attendance no BranchID | **Still open** → Phase 1K |
| Payroll / ledger attribution | **Still open** |
| Nightly HR job topology | **Still open** |

`domainOwnershipRegistry`: `inventory_stock` and `purchases` → `goLiveBlocker: false`.

---

## 5. GLEEM operational note

Tracked product sales now write `SALE` movements and update branch balance. With all balances at **0** and negative stock **allowed by default**, behavior matches pre-cutover "sell without qty gate."

**Optional hardening:** receive stock via purchase POST or manual adjust; set `INVENTORY_ALLOW_NEGATIVE_STOCK=false`.

---

## 6. Branch #2 retail checklist (when activated)

1. Bootstrap branch session (Phase 1G/H)  
2. Receive opening stock in **that branch's session** (purchase or count adjust)  
3. Set `INVENTORY_ALLOW_NEGATIVE_STOCK=false` (recommended)  
4. Do **not** expect GLEEM qty copy — PH1GTEST guard enforces zero rows at migration  
5. Use transfer API (future) for inter-branch replenishment — not manual dual-adjust  

---

## 7. Regression boundary

Confirmed unchanged:

| Item | State |
|---|---|
| GLEEM active branch count | **1** |
| PH1GTEST | **Inactive** |
| GLEEM financial/booking/queue data | No migration |
| Sync service | **Stopped** |
| Phase 1A–1I accepted contracts | Preserved |
| `TblProMove` legacy data | Untouched |

---

## 8. Artifacts delivered

**Migration**

* `db/migrations/add-branch-inventory-and-purchase-ownership.sql`

**Code**

* `src/lib/inventory/inventoryMutation.service.ts`  
* `src/lib/inventory/productTracking.ts`  
* `src/lib/inventory/purchaseInventory.service.ts`  
* `src/app/api/inventory/branch/route.ts`  
* `src/app/api/purchases/route.ts`  
* `src/app/api/sales/route.ts` (stock step)  
* `src/lib/actions/invoiceActions.ts` (reverse/re-apply)  
* `src/lib/branch/domainOwnershipRegistry.ts` (blocker update)

**Scripts**

* `scripts/audit-branches/15-phase1j-inventory-before.cjs`  
* `scripts/audit-branches/_phase1j-inventory-before.json`  
* `scripts/audit-branches/run-phase1j-migration.cjs`

**Tests**

* `src/lib/__tests__/phase1jBranchInventory.test.ts`

**Documentation (10 files)**

* `docs/branch-phase-1j-inventory-dependency-audit.md`  
* `docs/branch-phase-1j-product-tracking-contract.md`  
* `docs/branch-phase-1j-schema.md`  
* `docs/branch-phase-1j-stock-movement-contract.md`  
* `docs/branch-phase-1j-purchases-and-returns.md`  
* `docs/branch-phase-1j-pos-stock-integration.md`  
* `docs/branch-phase-1j-transfer-contract.md`  
* `docs/branch-phase-1j-migration-and-backfill.md`  
* `docs/branch-phase-1j-verification.md`  
* `docs/branch-phase-1j-closure.md`

---

## 9. Next-phase boundary

**Phase 1K (Attendance)** may proceed — inventory go-live blocker from Phase 1I is cleared.

Do **not** activate production branch #2 for full independent operations until attendance + HR/payroll decisions are implemented.

Acceptance of Phase 1J is **schema migration + stock integration + registry update + documented GO/CONDITIONAL GO**, not second-branch go-live.
