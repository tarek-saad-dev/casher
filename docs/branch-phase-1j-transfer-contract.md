# Phase 1J — Inter-Branch Transfer Contract

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Status:** **Schema + contract only** — no POST/receive API in Phase 1J

---

## 1. Why transfers are deferred

Phase 1J delivers branch-isolated balances and a movement ledger. Inter-branch stock movement requires explicit two-sided documents (out from source, in at destination) with posting workflow — out of scope for initial cutover.

**Live state:** `TblInventoryTransfer` and `TblInventoryTransferLine` tables **created empty**. No application routes reference them.

---

## 2. Schema (created, unused)

### `TblInventoryTransfer`

| Column | Notes |
|---|---|
| `TransferID` | PK |
| `FromBranchID`, `ToBranchID` | FK → `TblBranch`; **CHECK** `FromBranchID <> ToBranchID` |
| `Status` | Default **`DRAFT`** |
| `RequestedBy`, `PostedBy`, `ReceivedBy` | User refs |
| `CreatedAt`, `PostedAt`, `ReceivedAt` | Lifecycle timestamps |
| `Notes` | NVARCHAR(400) |
| `IdempotencyKey` | UNIQUE NULL |

### `TblInventoryTransferLine`

| Column | Notes |
|---|---|
| `TransferLineID` | PK |
| `TransferID` | FK |
| `ProID` | FK → `TblPro` |
| `Quantity` | CHECK **> 0** |

---

## 3. Planned movement pairing (future)

When implemented, each posted transfer line should emit **two** ledger rows in one transaction:

| Step | Branch | MovementType | Delta |
|---|---|---|---|
| Ship/post | `FromBranchID` | `TRANSFER_OUT` | Negative |
| Receive | `ToBranchID` | `TRANSFER_IN` | Positive |

Shared reference: `ReferenceType = 'TRANSFER'`, `ReferenceID = '{transferId}'`.

Both must share idempotency discipline and SERIALIZABLE isolation via `applyInventoryMutation`.

---

## 4. Fail-closed: no cross-branch manual adjust

Manual stock adjustment (`POST /api/inventory/branch`) is **strictly session-scoped**:

```typescript
if (body.branchId != null || body.BranchID != null) {
  return 400 // BranchID في الطلب غير مسموح
}
applyManualStockAdjustment({ branchId: session.branchId, ... })
```

**Implication:** operators cannot "transfer" stock by adjusting branch B up and branch A down via two manual calls from different sessions without an explicit transfer document — by design.

Manual adjust also sets `allowNegativeOverride: false` — cannot drive source branch deeply negative as a transfer workaround without elevated policy.

---

## 5. PH1GTEST isolation

Migration sanity check:

```sql
-- RAISERROR if any TblBranchInventory row exists for PH1GTEST
```

Post-migration: **PH1GTEST inventory rows = 0**. Future branch #2 receives stock only via:

* Purchase POST (`PURCHASE_RECEIPT`) in that branch's session, or  
* Manual adjust in that branch's session, or  
* Future transfer receive API

Never copied from GLEEM automatically.

---

## 6. Status lifecycle (contract)

| Status | Meaning |
|---|---|
| `DRAFT` | Lines editable; no stock impact |
| `POSTED` | Source `TRANSFER_OUT` applied (future) |
| `IN_TRANSIT` | Optional intermediate (future) |
| `RECEIVED` | Destination `TRANSFER_IN` applied (future) |
| `CANCELLED` | No further stock effect |

Exact enum values to be finalized when API is built; table default is `DRAFT`.

---

## 7. Explicit non-goals (Phase 1J)

* Transfer create/post/receive routes  
* UI for transfers  
* Sync of transfer tables  
* Auto-balancing PH1GTEST from GLEEM  
* Using manual adjust as implicit transfer

---

## 8. Branch #2 guidance

Before enabling physical product sales at a second branch:

1. Receive opening stock (purchase or manual count) **in that branch's session**  
2. Optionally set `INVENTORY_ALLOW_NEGATIVE_STOCK=false`  
3. Implement transfer API when inter-branch replenishment is required — do not use manual dual-adjust
