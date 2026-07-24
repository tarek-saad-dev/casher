# Phase 1J — Stock Movement Contract

**Date:** 2026-07-24  
**Sole mutation entry:** `src/lib/inventory/inventoryMutation.service.ts`  
**Database:** cloud / `last132`

---

## 1. Design principles

1. **Append-only ledger** — `TblInventoryMovement` rows are never updated or deleted; corrections use reversal rows with `ReversalOfMovementID`.
2. **Balance is derived state** — `TblBranchInventory.QtyOnHand` updated atomically with each movement in the same transaction.
3. **Idempotent writes** — every mutation requires `IdempotencyKey`; duplicate key returns prior result (`skipped: idempotent_replay`).
4. **Branch isolation** — all reads/writes keyed by session-resolved `BranchID`; never accept client-supplied branch for mutations.
5. **Non-tracked skip** — service/non-retail products produce no movement (not an error).

---

## 2. Movement types

Defined in `INVENTORY_MOVEMENT_TYPES` (`productTracking.ts`):

| Type | Direction | Phase 1J active |
|---|---|---|
| `OPENING_BALANCE` | ± from zero | Migration only (non-zero openings) |
| `SALE` | Negative delta | **Yes** — POS create |
| `SALE_REVERSAL` | Opposite of SALE | **Yes** — delete/update |
| `PURCHASE_RECEIPT` | Positive | **Yes** — purchase POST |
| `PURCHASE_RETURN` | Negative | Contract only (no API yet) |
| `MANUAL_ADJUSTMENT_IN` | Positive | **Yes** — inventory POST |
| `MANUAL_ADJUSTMENT_OUT` | Negative | **Yes** — inventory POST |
| `STOCK_COUNT_ADJUSTMENT` | ± to counted qty | **Yes** — `setCountedTo` |
| `TRANSFER_OUT` | Negative | Schema/contract only |
| `TRANSFER_IN` | Positive | Schema/contract only |
| `LEGACY_IMPORT` | — | Reserved; **not used** (`TblProMove` not imported) |

---

## 3. Reference typing

| ReferenceType | ReferenceID format | Used by |
|---|---|---|
| `SALE_INVOICE` | `{invType}:{invId}` e.g. `مبيعات:3581` | POS sales |
| `PURCHASE` | `{invType}:{invId}` e.g. `مشتريات:1` | Purchase POST |
| `MANUAL_ADJUSTMENT` | `{userId}` | Branch adjust API |
| `LEGACY_TBLPRO_QTY` | `GLEEM:{proId}` | Opening balance (non-zero only) |

---

## 4. Idempotency key patterns

| Operation | Key pattern |
|---|---|
| Sale line (create) | `SALE:{branchId}:{invType}:{invId}:g{generation}:{lineKey}` |
| Sale reversal | `SALE_REVERSAL:{originalSaleKey}` |
| Purchase receipt line | `PURCHASE_RECEIPT:{branchId}:{invType}:{invId}:{lineIdx}:{proId}` |
| Manual adjust (delta) | `ADJ:{branchId}:{proId}:{userId}:{timestamp}:...` |
| Manual count set | `ADJ_SET:{branchId}:{proId}:{target}:{reason}` |
| Opening balance | `OPENING:GLEEM:{proId}` |

**Update cycle:** `reverseSaleStockMovements` returns `nextGeneration = max reversed MovementID`; re-apply uses `g{nextGeneration}` to avoid key collision.

---

## 5. Concurrency and isolation

Every `applyInventoryMutation` call within a caller transaction:

```sql
SELECT ... FROM dbo.TblBranchInventory WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
WHERE BranchID = @branchId AND ProID = @proId
```

Caller routes use:

```typescript
transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
```

**Invariant:** financial work (invoice, purchase) and stock mutation share **one transaction** — rollback reverts both.

---

## 6. Negative stock gate

| Context | Policy |
|---|---|
| POS sale | `allowNegativeStock()` env (default **true**) |
| Manual adjustment | **Always enforce non-negative** (`allowNegativeOverride: false`) |
| Purchase receipt | N/A (positive delta only) |

Failure code: `INSUFFICIENT_STOCK` (HTTP 409).

---

## 7. Balance bootstrap

`ensureBranchInventoryBalance(branchId, proId)`:

* If no `(BranchID, ProID)` row → INSERT with `QtyOnHand = 0`
* Never copies qty from another branch or from `TblPro.Qty`

Migration pre-seeds GLEEM rows for 8 tracked products only.

---

## 8. Reversal semantics

`reverseSaleStockMovements`:

1. Select unreversed `SALE` movements for invoice ref
2. Insert `SALE_REVERSAL` with `quantityDelta = -originalDelta`
3. Set `ReversalOfMovementID = original MovementID`
4. Balance restored via standard mutation path

Used on invoice **delete** and **update** (before line replace).

---

## 9. Forbidden patterns

| Pattern | Status |
|---|---|
| Direct UPDATE `TblBranchInventory` outside mutation service | **Forbidden** |
| INSERT movement without balance update | **Forbidden** |
| UPDATE/DELETE movement rows | **Forbidden** |
| Write `TblPro.Qty` | **Forbidden** |
| Import `TblProMove` into ledger | **Forbidden** (double-count risk) |
| Body-supplied `BranchID` on adjust/purchase | **Rejected** (400) |

---

## 10. Live post-migration ledger state

| Metric | Value |
|---|---:|
| `TblInventoryMovement` total rows | **0** |
| Reason | All opening `QtyOnHand = 0`; CHECK `QuantityDelta <> 0` skips zero openings |
| `TblProMove` legacy rows | **49** (unchanged, read-only) |
