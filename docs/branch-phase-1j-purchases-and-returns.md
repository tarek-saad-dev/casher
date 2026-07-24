# Phase 1J — Purchases and Returns

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**API:** `GET/POST /api/purchases`  
**Service:** `src/lib/inventory/purchaseInventory.service.ts`

---

## 1. Live pre/post facts

| Table | Rows (before) | Rows (after) | BranchID |
|---|---:|---:|---|
| `TblinvPurchaseHead` | **0** | **0** | **NOT NULL** (added) |
| `TblinvPurchaseDetail` | **0** | **0** | CHILD_INHERIT |
| `TblinvRePurchase` | **0** | **0** | No change |

Purchase head had **no BranchID** before Phase 1J. Empty table allowed immediate NOT NULL without ownership guessing.

---

## 2. New purchase head columns

| Column | Type | Default | Purpose |
|---|---|---|---|
| `BranchID` | INT NOT NULL | — | Branch ownership; FK → `TblBranch` |
| `PostStatus` | NVARCHAR(30) NOT NULL | **`DRAFT`** | Lifecycle: DRAFT → POSTED (or CANCELLED) |
| `ReturnOfPurchaseInvID` | INT NULL | — | Link purchase return to original invoice |

**Index:** `IX_TblinvPurchaseHead_Branch_Date`

---

## 3. Ownership model

```
GLOBAL_MASTER:     TblPro (product identity)
BRANCH_OWNED_ROOT: TblinvPurchaseHead (BranchID NOT NULL)
CHILD_INHERIT:     TblinvPurchaseDetail (via invID + invType)
```

**BranchID source:** session via `resolveBranchDayAndShiftForWrite` — **never** from request body.

Body `branchId` / `BranchID` → **400** `BranchID في الطلب غير مسموح`.

---

## 4. POST /api/purchases flow

**Request body:**

```json
{
  "lines": [{ "proId": 24, "qty": 10, "unitPrice": 50 }],
  "notes": "optional",
  "post": false
}
```

| Step | Action |
|---|---|
| 1 | Gate: authenticated user + open day/shift for session branch |
| 2 | Allocate `invID` under `invType = 'مشتريات'` |
| 3 | INSERT head with `BranchID`, `PostStatus = DRAFT`, shift/day refs |
| 4 | INSERT detail lines |
| 5 | If `post: true` → `postPurchaseReceipt` in same TX |

**Response:** `{ invID, invType, branchId, postStatus: 'DRAFT' | 'POSTED' }`

---

## 5. Posting and stock receipt

`postPurchaseReceipt`:

| Check | Behavior |
|---|---|
| Head exists for `(invId, invType)` | Required |
| Head.BranchID = session branch | Else `PURCHASE_NOT_FOUND` (404) |
| PostStatus already POSTED | Idempotent no-op on movements |
| PostStatus CANCELLED | Error 409 |
| Line product not stock-tracked | Skip movement (not error) |
| Stock-tracked line | `PURCHASE_RECEIPT` movement (+qty) |

After lines processed: `UPDATE PostStatus = N'POSTED'`.

**Idempotency:** `PURCHASE_RECEIPT:{branchId}:{invType}:{invId}:{lineIdx}:{proId}`

---

## 6. GET /api/purchases

Returns TOP 100 purchase heads **WHERE BranchID = session branch** ORDER BY invDate DESC.

---

## 7. Returns (`TblinvRePurchase`)

| Item | Phase 1J status |
|---|---|
| `ReturnOfPurchaseInvID` on head | **Column added** |
| `TblinvRePurchase` table | Unchanged; **0 rows** |
| Return POST API | **Not implemented** |
| `PURCHASE_RETURN` movement type | Defined in contract; reserved |

Future return flow must:

1. Create return head with `ReturnOfPurchaseInvID` pointing to original
2. Stamp same `BranchID` as original (from head, not body)
3. Emit `PURCHASE_RETURN` negative movements on POST only

---

## 8. DRAFT vs POSTED stock impact

| PostStatus | Stock effect |
|---|---|
| `DRAFT` | **None** — head/detail only |
| `POSTED` | Positive `PURCHASE_RECEIPT` movements |
| `CANCELLED` | No post allowed |

Aligns with financial pattern: draft documents do not mutate operational balances.

---

## 9. Branch #2 readiness

| Check | Status |
|---|---|
| Purchase BranchID owned | **GO** |
| Empty history (no backfill guess) | **GO** |
| Stock on POST only | **GO** |
| Session-scoped list/create | **GO** |

Recommended before branch #2 retail: receive opening stock via purchase POST or manual adjust before enabling `INVENTORY_ALLOW_NEGATIVE_STOCK=false`.
