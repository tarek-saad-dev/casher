# Phase 1J — Migration and Backfill

**Migration:** `db/migrations/add-branch-inventory-and-purchase-ownership.sql`  
**Runner:** `scripts/audit-branches/run-phase1j-migration.cjs`  
**Pre-capture:** `scripts/audit-branches/15-phase1j-inventory-before.cjs` → `_phase1j-inventory-before.json`  
**Database:** cloud / `last132` only  
**Captured:** 2026-07-24T00:58:52Z

---

## 1. Preconditions (enforced in SQL)

| Check | Requirement |
|---|---|
| Database name | Must be `last132` |
| GLEEM exists | `BranchCode = N'GLEEM'`, **IsActive = 1** |
| PH1GTEST | May exist inactive — not required |
| Purchase rows without BranchID | **Abort** if rows exist and column missing |
| PH1GTEST inventory after backfill | **Abort** if any `TblBranchInventory` row for PH1GTEST |

---

## 2. Migration steps (idempotent)

| # | Step | Idempotent mechanism |
|---|---|---|
| 0 | Guard purchase ownership | EXISTS checks |
| 1 | CREATE `TblBranchInventory` + indexes | `IF OBJECT_ID IS NULL` |
| 2 | CREATE `TblInventoryMovement` + indexes | `IF OBJECT_ID IS NULL` |
| 3 | ALTER `TblinvPurchaseHead` — BranchID, PostStatus, ReturnOfPurchaseInvID | `COL_LENGTH IS NULL` |
| 4 | SET purchase BranchID NOT NULL + FK | Only when no null rows |
| 5 | CREATE `TblInventoryTransfer` + lines | `IF OBJECT_ID IS NULL` |
| 6 | INSERT GLEEM opening balances (tracked products) | `WHERE NOT EXISTS (BranchID, ProID)` |
| 7 | INSERT opening movements (non-zero qty only) | IdempotencyKey + qty <> 0 |
| 8 | Annotate `TblPro.Qty` deprecated | Extended property IF NOT EXISTS |
| 9 | Sanity: zero PH1GTEST inventory | RAISERROR |

**Rerun:** confirmed OK — duplicate inserts skipped via NOT EXISTS / idempotency keys.

---

## 3. Opening balance backfill

**Tracked product rule:**

```sql
WHERE LOWER(ISNULL(c.CatType, N'')) = N'pro'
   OR LOWER(ISNULL(p.ProType, N'')) = N'pro'
```

**Qty source:** `ISNULL(TblPro.Qty, 0)` per product.

| Metric | Value |
|---|---:|
| Tracked products | **8** |
| GLEEM balance rows inserted | **8** |
| Sum QtyOnHand | **0** |
| PH1GTEST balance rows | **0** |

All live `TblPro.Qty` values are null or zero (`totalQty=0`, `nonzero=0`, `nullQty=18`).

---

## 4. Opening movement backfill

Opening `OPENING_BALANCE` movements inserted **only when** `QtyOnHand <> 0`.

| Result | Reason |
|---|---|
| **0 movement rows** | All opening balances zero |
| CHECK satisfied | `QuantityDelta <> 0` — zero-delta openings forbidden |

**Documented invariant:** For zero openings, `TblBranchInventory` row alone is authoritative; ledger starts empty until first operational mutation (sale, purchase, adjust).

---

## 5. Legacy `TblProMove` — explicit non-import

| Fact | Decision |
|---|---|
| Row count | **49** |
| Content | Historical desktop sales-out (`inOut='out'`) |
| Branch scope | None |
| Import to `TblInventoryMovement`? | **NO** |

**Rationale:** Opening snapshot from `TblPro.Qty` is all zeros. Importing 49 outs would imply negative stock or require synthetic opening qty — both incorrect. Table remains read-only archive.

Movement type `LEGACY_IMPORT` reserved but **unused**.

---

## 6. Purchase schema backfill

| Table | Rows before | Rows after | BranchID backfill |
|---|---:|---:|---|
| `TblinvPurchaseHead` | **0** | **0** | N/A — empty table → immediate NOT NULL |
| `TblinvPurchaseDetail` | **0** | **0** | CHILD_INHERIT unchanged |
| `TblinvRePurchase` | **0** | **0** | No change |

No ownership guessing required.

---

## 7. Deprecated column

`TblPro.Qty` — extended property added; column retained.

Application cutover: **stop all operational reads/writes** of `TblPro.Qty`; use `TblBranchInventory.QtyOnHand`.

**No dual-write** during or after migration.

---

## 8. Post-migration fingerprint

| Object | Expected |
|---|---|
| `TblBranchInventory` GLEEM rows | **8** |
| `TblBranchInventory` GLEEM qtySum | **0** |
| `TblBranchInventory` PH1GTEST rows | **0** |
| `TblInventoryMovement` count | **0** |
| `TblinvPurchaseHead.BranchID` | NOT NULL column exists |
| `TblinvPurchaseHead.PostStatus` | Default DRAFT |
| `TblInventoryTransfer` | Table exists, 0 rows |
| `TblProMove` | **49** rows unchanged |
| Active branches | **1** (GLEEM only) |

---

## 9. Rollback posture

No automated down migration. Rollback would require:

1. Remove app stock integration (redeploy prior code)  
2. Drop new tables/columns only after confirming no production movements  

**Forward-only** acceptance for live `last132`.

---

## 10. What migration does not do

* Activate PH1GTEST  
* Copy GLEEM qty to second branch  
* Import `TblProMove`  
* Modify HR/attendance  
* Restart sync  
* Enable transfer API
