# Phase 1J — Inventory Dependency Audit

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Pre-capture:** `scripts/audit-branches/_phase1j-inventory-before.json`  
**Migration:** `db/migrations/add-branch-inventory-and-purchase-ownership.sql`  
**GLEEM:** `BranchID = 1` (active) · **PH1GTEST:** `BranchID = 2` (inactive)

---

## 1. Pre-migration live facts

| Object | Exists | Rows | BranchID | Notes |
|---|---|---:|---|---|
| `TblPro` | Yes | **50** | No | `Qty` column present; **all null or 0** (`totalQty=0`, `nonzero=0`, `nullQty=18`) |
| `TblCat` | Yes | — | No | `CatType`: **36** `serv`, **8** `pro`, **6** null |
| `TblBarCode` | Yes | 0 | No | Unused |
| `TblProMove` | Yes | **49** | No | Legacy desktop sales-out history; no active API in repo |
| `TblinvPurchaseHead` | Yes | **0** | **No** (pre) | No purchase write API before Phase 1J |
| `TblinvPurchaseDetail` | Yes | **0** | No | Child of purchase head |
| `TblinvRePurchase` | Yes | **0** | No | Return path in sync registry only |
| `TblBranchInventory` | **No** (pre) | — | — | Created in Phase 1J |
| `TblInventoryMovement` | **No** (pre) | — | — | Created in Phase 1J |

---

## 2. Product classification (pre-migration proven)

| Bucket | Count | Rule |
|---|---:|---|
| Stock-tracked | **8** | `CatType='pro'` OR `ProType='pro'` (case-insensitive) |
| Services | **36** | `CatType='serv'` |
| Non-tracked remainder | **6** | Services with null `CatType`; admin lines; etc. |

**Stock-tracked ProIDs (live):**

| ProID | ProName | ProType | CatType |
|---:|---|---|---|
| 24 | ثيرم | pro | pro |
| 25 | شامبو | pro | pro |
| 26 | بلسم | pro | pro |
| 27 | حمام كريم | pro | pro |
| 28 | برفيوم SF | pro | pro |
| 33 | بلوب كيرلي | pro | pro |
| 37 | معالج الشعر | pro | pro |
| 1058 | texture powder | **null** | pro |

No `TrackStock` column exists or was added — classification from `CatType`/`ProType` is sufficient on live catalog.

---

## 3. Legacy movement table (`TblProMove`)

| Fact | Value |
|---|---|
| Row count | **49** |
| Columns | ID, invID, invType, invDate, invTime, ProID, Qty, inOut, Notes |
| Branch scope | None |
| App references in `src/` | **None** |
| Phase 1J treatment | **Read-only archive** — **not** imported into `TblInventoryMovement` |

**Why not import:** Opening balances come from `TblPro.Qty` snapshot (all zero). Importing `TblProMove` would double-count historical outs against a zero opening.

---

## 4. Application write/read paths (pre → post)

| Path | Pre-1J | Post-1J |
|---|---|---|
| `POST /api/sales` | Invoice lines only; **no stock write** | `applySaleStockDecrements` in same TX |
| Invoice update (`invoiceActions.ts`) | No stock | `reverseSaleStockMovements` → re-apply |
| Invoice delete | No stock | `reverseSaleStockMovements` before delete |
| `TblPro.Qty` | Deprecated column; never written by POS | Extended property **DEPRECATED**; **no dual-write** |
| Purchase routes | None | `GET/POST /api/purchases` — BranchID from session |
| Branch inventory routes | None | `GET/POST /api/inventory/branch` |
| Manual adjustment | None | POST inventory branch — session BranchID only |
| Inter-branch transfer | None | Schema only (`TblInventoryTransfer`); **no API** |
| POS product qty display | Global `TblPro.Qty` (always 0/null) | Should read `TblBranchInventory` for active branch |

---

## 5. Failure scenarios addressed

| # | Failure (Phase 1I) | Phase 1J treatment |
|---|---|---|
| 1 | Sale in branch B reduces GLEEM global qty | **Fixed** — `TblBranchInventory` per branch |
| 2 | Purchase increases all-branch stock | **Fixed** — `TblinvPurchaseHead.BranchID NOT NULL` |
| 3 | Same qty shown in both branches | **Fixed** — balance keyed `(BranchID, ProID)` |
| 4 | Global low-stock alert mixing branches | **Ready** — query by `BranchID` |
| 5 | Return restores stock to wrong branch | **Ready** — purchase/return scoped by head BranchID |
| 6 | Stock edit trusts browser BranchID | **Fail-closed** — body `BranchID` rejected; session wins |
| 7 | Concurrent double-decrement | **Mitigated** — `UPDLOCK`+`HOLDLOCK`+`SERIALIZABLE` TX |
| 8 | Duplicate movement on retry | **Mitigated** — `IdempotencyKey` unique on ledger |
| 9 | Inter-branch transfer as manual adjust | **Blocked** — manual adjust session-scoped only; transfer tables schema-only |

---

## 6. Explicit non-goals (frozen)

* Activate PH1GTEST or any second production branch  
* Copy GLEEM stock rows to PH1GTEST (post-migration: **0 rows** on PH1GTEST)  
* Import `TblProMove` into new ledger  
* Dual-write `TblPro.Qty`  
* HR / attendance / payroll schema changes  
* Restart sync service  
* Transfer POST/receive API (schema + contract only)  
* Drop `TblPro.Qty` column (deprecated in place)

---

## 7. Registry update

`domainOwnershipRegistry.ts`:

| Domain | Classification | `goLiveBlocker` (post-1J) |
|---|---|---|
| `inventory_stock` | HYBRID — global catalog + branch `QtyOnHand` | **false** |
| `purchases` | BRANCH_OWNED_ROOT | **false** |

---

## 8. Classification summary

```
GLOBAL_MASTER:     TblPro, TblCat (identity, price, classification flags)
BRANCH_OWNED:      TblBranchInventory, TblInventoryMovement
BRANCH_OWNED_ROOT: TblinvPurchaseHead (+ BranchID NOT NULL)
CHILD_INHERIT:     TblinvPurchaseDetail
SCHEMA_ONLY:       TblInventoryTransfer, TblInventoryTransferLine
READ_ONLY_LEGACY:  TblProMove (49 rows)
DEPRECATED:        TblPro.Qty (extended property; do not use for POS)
```
