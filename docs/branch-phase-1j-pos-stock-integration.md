# Phase 1J — POS Stock Integration

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Scope:** Wire branch inventory into existing sales invoice lifecycle

---

## 1. Before Phase 1J

| Fact | Detail |
|---|---|
| `POST /api/sales` | Wrote `TblinvServHead` / detail / payment / cash only |
| `TblPro.Qty` | Never updated by POS API (confirmed by code audit) |
| Tracked product sales | Occurred at GLEEM with null/0 catalog qty — no enforcement |
| Stock decrement | **None** |

Legacy desktop wrote **49** rows to `TblProMove` (historical outs). Not replayed in Phase 1J.

---

## 2. After Phase 1J — create sale

**File:** `src/app/api/sales/route.ts` (step 3b, same transaction as invoice insert)

```
applySaleStockDecrements(transaction, {
  branchId,           // from session day/shift gate
  invId: newInvID,
  invType,              // typically 'مبيعات'
  businessDayId,
  shiftMoveId,
  userId,
  lines: items.map((item, idx) => ({
    proId: item.proId,
    qty: item.qty > 0 ? item.qty : 1,
    lineKey: `${idx}:${item.proId}`,
  })),
})
```

| Line type | Movement |
|---|---|
| Stock-tracked product (`CatType/ProType` rule) | `SALE` negative delta |
| Service / non-tracked | Skipped (`not_stock_tracked`) |

Failure (`INSUFFICIENT_STOCK` when negative disallowed) rolls back **entire sale transaction**.

---

## 3. Update sale

**File:** `src/lib/actions/invoiceActions.ts` → `updateInvoice`

| Step | Stock action |
|---|---|
| 1 | `reverseSaleStockMovements` — restore prior SALE deltas |
| 2 | Delete/replace invoice children (existing behavior) |
| 3 | `applySaleStockDecrements` with `generation: nextGeneration` |

`nextGeneration` = max reversed `MovementID` (or 0) — prevents idempotency key collision on re-apply.

Branch ownership read from **existing invoice head** — never from update payload.

---

## 4. Delete sale

**File:** `src/lib/actions/invoiceActions.ts` → delete path

| Step | Stock action |
|---|---|
| 1 | Verify head.BranchID = active session branch |
| 2 | `reverseSaleStockMovements` |
| 3 | Delete cash, loyalty, detail, payment, head |

---

## 5. Transaction boundary

Sales create/update/delete already run inside SQL transactions with applocks. Stock mutations are **in the same transaction** as financial writes:

```
BEGIN SERIALIZABLE
  -- invoice head/detail/payment/cash
  -- applySaleStockDecrements OR reverse + re-apply
COMMIT / ROLLBACK
```

Partial failure (stock error after detail insert) leaves no orphan invoice without matching stock state.

---

## 6. Negative stock and GLEEM continuity

| Setting | Default | GLEEM impact |
|---|---|---|
| `INVENTORY_ALLOW_NEGATIVE_STOCK` | **true** (unset) | Sales continue even at `QtyOnHand = 0` |

Post-migration GLEEM balances: **8 rows, all `QtyOnHand = 0`**. First tracked product sale after cutover will write `SALE` movement and drive balance negative unless stock received first.

**Operational note:** Product stock is now **tracked in ledger** even when negative is allowed. Reports can show branch qty; behavior matches pre-cutover "sell without qty check" until env flipped.

---

## 7. What POS does not do

| Item | Status |
|---|---|
| UPDATE `TblPro.Qty` | **Never** |
| Read global qty for display | Should migrate UI to `GET /api/inventory/branch` |
| Cross-branch stock decrement | **Prevented** — branchId from session only |
| Service line stock impact | **None** (36 services untracked) |

---

## 8. Tracked products on live catalog

Sales of these ProIDs emit `SALE` movements when qty > 0 on line:

24, 25, 26, 27, 28, 33, 37, 1058

(ثيرم, شامبو, بلسم, حمام كريم, برفيوم SF, بلوب كيرلي, معالج الشعر, texture powder)

---

## 9. Verification hooks

`phase1jBranchInventory.test.ts` asserts:

* `sales/route.ts` contains `applySaleStockDecrements`
* `sales/route.ts` does not UPDATE `TblPro.Qty`
* `invoiceActions.ts` contains reverse + re-apply paths
* Idempotency keys include generation suffix
