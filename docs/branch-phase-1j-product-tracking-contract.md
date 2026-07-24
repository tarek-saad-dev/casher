# Phase 1J — Product Stock-Tracking Contract

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Implementation:** `src/lib/inventory/productTracking.ts`

---

## 1. Classification rule (authoritative)

A product is **stock-tracked** when **either** condition holds (case-insensitive):

```
LOWER(CatType) = 'pro'
OR
LOWER(ProType) IN ('pro', 'product')
```

**No `TrackStock` column** is used or required. Live catalog classification is proven on `last132`.

---

## 2. Live catalog counts

| Metric | Count |
|---|---:|
| `TblPro` total rows | **50** |
| Stock-tracked | **8** |
| Services (`CatType='serv'`) | **36** |
| Non-tracked (other) | **6** |

---

## 3. Stock-tracked products (live ProIDs)

| ProID | ProName | ProType | CatType | TblPro.Qty (pre) |
|---:|---|---|---|---|
| 24 | ثيرم | pro | pro | null |
| 25 | شامبو | pro | pro | null |
| 26 | بلسم | pro | pro | null |
| 27 | حمام كريم | pro | pro | null |
| 28 | برفيوم SF | pro | pro | null |
| 33 | بلوب كيرلي | pro | pro | null |
| 37 | معالج الشعر | pro | pro | null |
| 1058 | texture powder | **null** | pro | null |

**Edge case proven:** ProID **1058** has `ProType = null` but `CatType = 'pro'` → **tracked**.

---

## 4. Non-tracked examples

| Pattern | Example | Behavior |
|---|---|---|
| Service by `CatType` | ProID 9 Hair Cut (`ProType=serv`, `CatType=serv`) | `applyInventoryMutation` returns `skipped: not_stock_tracked` |
| Service by `ProType` only | ProID 15 Short Hair Protein (`ProType=serv`, `CatType=null`) | Not tracked |
| Admin / treasury line | ProID 30 (cash return line) | Not tracked |

Sale lines for non-tracked products proceed without ledger rows.

---

## 5. API surface

```typescript
isStockTrackedProduct({ proId, proType, catType }): boolean
allowNegativeStock(): boolean
INVENTORY_MOVEMENT_TYPES: readonly [...]
```

---

## 6. Negative stock policy

| Env var | Default | Meaning |
|---|---|---|
| `INVENTORY_ALLOW_NEGATIVE_STOCK` | **true** (unset) | Allow sale/adjustment to drive `QtyOnHand` below zero |

**Continuity rationale:** GLEEM already sells tracked products with `TblPro.Qty` null/0 and no stock checks. Default **true** preserves operational behavior until operators receive stock and optionally set `INVENTORY_ALLOW_NEGATIVE_STOCK=false`.

| Caller | Override |
|---|---|
| POS sale (`applySaleStockDecrements`) | Uses env policy |
| Manual adjustment (`applyManualStockAdjustment`) | **`allowNegativeOverride: false`** always — manual adjust cannot go negative |

---

## 7. Catalog vs balance ownership

| Concern | Table | Scope |
|---|---|---|
| Product identity, name, price, `ProType` | `TblPro` | **GLOBAL_MASTER** |
| Category type | `TblCat` | **GLOBAL_MASTER** |
| Operational quantity | `TblBranchInventory.QtyOnHand` | **BRANCH_OWNED** |
| Legacy qty column | `TblPro.Qty` | **DEPRECATED** — do not read/write for POS |

Adding a new retail product: create global `TblPro` row with `CatType='pro'` or `ProType='pro'`. First mutation or migration backfill creates `(BranchID, ProID)` balance row.

---

## 8. Contract tests

`src/lib/__tests__/phase1jBranchInventory.test.ts`:

* CatType/ProType classification matrix  
* Negative-stock env parsing  
* texture-powder-style CatType-only case covered by `catType='pro'` test
