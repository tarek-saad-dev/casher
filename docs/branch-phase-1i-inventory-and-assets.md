# Phase 1I — Inventory, Purchases, and Product Movement

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Phase 1I scope:** Audit and document only — **no inventory schema migration implemented**

---

## 1. Live schema facts

| Object | Exists | Rows | BranchID | Notes |
|---|---|---:|---|---|
| `TblPro` | Yes | 50 | No | **`Qty` column present** — stock stored on catalog row |
| `TblBarCode` | Yes | 0 | No | Unused |
| `TblProMove` | Yes | 49 | No | Movement history; no active API in repo |
| `TblinvPurchaseHead` | Yes | 0 | **No** | Columns: ID, invID, invType, invDate, ClientID, UserID, totals, ShiftMoveID — no BranchID |
| `TblinvPurchaseDetail` | Yes | — | No | Child of purchase head |
| `TblinvRePurchase` | CT-tracked | — | No | Return path exists in sync registry |

Audit flags: `purchaseHasBranch: false`; `proHasQty: true`.

---

## 2. Current ownership model (as-is)

```
Product identity (TblPro)     = GLOBAL_MASTER
Stock quantity (TblPro.Qty)   = effectively GLOBAL (wrong for multi-branch)
Purchase invoices             = unscoped (no BranchID, no active write API)
Stock movements (TblProMove)  = unscoped historical rows
Sale line qty (TblinvServDetail.Qty) = CHILD_INHERIT from branch-owned invoice
```

Physical product sales on a service invoice would reference global `ProID` and, if stock decrement occurs, would mutate **global** `TblPro.Qty` — affecting all branches.

---

## 3. Application write/read paths audited

| Path | Branch awareness | Stock behavior |
|---|---|---|
| `POST /api/sales` | Branch via session day/shift | Writes invoice lines with `ProType`, `Qty`; **no branch-scoped stock table** |
| Service catalog admin / seeds | Global | Updates `TblPro` including catalog fields |
| Purchase routes | **None active** in `src/app/api` | Purchases not exposed in current POS API surface |
| `TblProMove` | **No references** in `src/` TypeScript | Legacy / manual / external |
| POS product display | Reads global `TblPro` | Same qty shown regardless of branch |
| Low-stock / inventory reports | Not branch-filtered | Would aggregate globally |

**Conclusion:** For GLEEM-only production, global qty is latent (services dominate; 50 products, purchase head empty). For branch #2 selling physical retail products, global qty is a **data corruption risk**.

---

## 4. Failure scenarios (must prevent before branch #2 product sales)

| # | Failure | Current risk |
|---|---|---|
| 1 | Product sold in branch B reduces GLEEM stock | **Yes** — single `TblPro.Qty` |
| 2 | Purchase in branch B increases all-branch stock | **Yes** — no BranchID on purchase head |
| 3 | Same qty displayed in both branches | **Yes** |
| 4 | Global low-stock alert mixing branches | **Yes** if alerts exist |
| 5 | Return restores stock to wrong branch | **Yes** — no branch on purchase/return |
| 6 | Stock edit trusts browser BranchID | N/A today — no stock API; future must use session |
| 7 | Product delete affects all branches' history | **Partial** — soft delete on global row; invoice history preserved via lines |
| 8 | Inter-branch transfer recorded as adjustment | **Yes** — no transfer entity |

---

## 5. Preferred target model (future work — not done in 1I)

Do **not** duplicate `TblPro` per branch.

```
GLOBAL_MASTER:     TblPro (identity, name, barcode, default price, ProType)
BRANCH_OWNED:      Branch inventory balance (BranchID + ProID → QtyOnHand)
BRANCH_OWNED:      TblProMove or equivalent (BranchID, ProID, delta, reason, ref)
BRANCH_OWNED_ROOT: TblinvPurchaseHead (+ BranchID NOT NULL, backfill from shift/session evidence)
CHILD_INHERIT:     TblinvPurchaseDetail
```

Optional later: explicit inter-branch transfer document (from BranchID, to BranchID, lines).

**Migration principles (when approved):**

1. Capture before fingerprints on `TblPro.Qty`, `TblProMove`, purchases.
2. Create branch balance table; backfill GLEEM from current `TblPro.Qty` (single active branch — no guesswork for PH1GTEST).
3. Add `BranchID` to purchase head only after write-path design.
4. Redirect stock mutations to branch balance; stop writing `TblPro.Qty` for operational stock (or freeze column as deprecated).
5. Idempotent migration + verifier; **do not activate branch #2** until complete.

---

## 6. Relationship to POS sales

Service lines (`ProType` service) do not consume retail stock today in most flows. Retail/product lines on invoices **would** touch qty if enabled. Until branch inventory exists:

| Operational mode | Branch #2 verdict |
|---|---|
| Services-only POS (no retail qty decrement) | Conditional — same as services at GLEEM |
| Physical product sales with stock tracking | **NO-GO** |

---

## 7. Tools and fixed assets

`TblTools`, `TblToolsTransactions` appear in sync registry (CT-enabled) but were not primary Phase 1I live inventory targets. Treat as **DEFERRED_REQUIRES_BUSINESS_DECISION** — likely branch-owned if activated. No Phase 1I schema change.

---

## 8. Phase 1I decision

| Question | Answer |
|---|---|
| Is global stock a go-live blocker for product sales on branch #2? | **Yes** |
| Was inventory schema implemented in Phase 1I? | **No** |
| Safe to continue GLEEM-only? | **Yes** (single branch, global qty consistent) |
| Registry entry | `inventory_stock`, `purchases` marked `goLiveBlocker: true` in `domainOwnershipRegistry.ts` |

**Required future work:** Branch inventory balance + purchase BranchID + movement scoping — separate phase with business sign-off and migration safety per Phase 1I brief Part 20.
