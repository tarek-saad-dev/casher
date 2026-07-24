# Phase 1J — Verification

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Scope:** Branch inventory schema migration + application stock integration

---

## 1. Live database verification

**Pre-capture:** `scripts/audit-branches/_phase1j-inventory-before.json` (2026-07-24T00:58:52Z)

| Check | Result |
|---|---|
| Expected database | `last132` |
| GLEEM | `BranchID=1`, **IsActive=true** |
| PH1GTEST | `BranchID=2`, **IsActive=false** |
| `TblPro` rows | **50** |
| `TblPro.Qty` stats | `totalQty=0`, `nonzero=0`, `nullQty=18` |
| Stock-tracked products | **8** (ProIDs 24,25,26,27,28,33,37,1058) |
| Services (`CatType=serv`) | **36** |
| `TblProMove` rows | **49** (unchanged post-migration) |
| Purchase tables rows | **0** / **0** / **0** (head/detail/repurchase) |
| `purchaseHasBranch` (pre) | false → **true post** |

**Post-migration:**

| Check | Result |
|---|---|
| `TblBranchInventory` GLEEM rows | **8** |
| `TblBranchInventory` GLEEM qtySum | **0** |
| `TblBranchInventory` PH1GTEST rows | **0** |
| `TblInventoryMovement` count | **0** |
| `TblInventoryTransfer` + lines | Tables exist |
| Migration idempotent rerun | **OK** |
| `TblPro.Qty` extended property | DEPRECATED annotation present |
| Second branch activated | **No** |
| Sync service | **Stopped** (unchanged) |
| HR schema changes | **None** |

---

## 2. Schema contract checks

Migration file must contain:

| Artifact | Present |
|---|---|
| `TblBranchInventory` + `UQ_TblBranchInventory_Branch_Pro` | ✓ |
| `TblInventoryMovement` + `UQ_TblInventoryMovement_Idempotency` | ✓ |
| `CK_TblInventoryMovement_DeltaNonZero` | ✓ |
| Purchase `BranchID NOT NULL` path | ✓ |
| GLEEM-only backfill | ✓ |
| PH1GTEST guard | ✓ |
| `TblInventoryTransfer` schema | ✓ |

---

## 3. Application contract checks

**Sole mutation entry:** `src/lib/inventory/inventoryMutation.service.ts`

| Requirement | Verified by |
|---|---|
| `UPDLOCK` + `HOLDLOCK` on balance | source + unit test |
| `IdempotencyKey` unique handling | source + unit test |
| No `UPDATE TblPro.Qty` | source grep + unit test |
| Sale create decrements | `sales/route.ts` |
| Sale update reverse + re-apply | `invoiceActions.ts` |
| Sale delete reverse | `invoiceActions.ts` |
| Body BranchID rejected | `purchases/route.ts`, `inventory/branch/route.ts` |
| Negative stock default true | `productTracking.ts` + unit test |

---

## 4. API routes

| Route | Method | Branch gate |
|---|---|---|
| `/api/inventory/branch` | GET | `requireBranchOperationAccess` |
| `/api/inventory/branch` | POST | Session branch; rejects body BranchID |
| `/api/purchases` | GET | `WHERE BranchID = @branchId` |
| `/api/purchases` | POST | `resolveBranchDayAndShiftForWrite` |

---

## 5. Domain ownership registry

Post-Phase 1J:

| Domain | `goLiveBlocker` |
|---|---|
| `inventory_stock` | **false** |
| `purchases` | **false** |
| `attendance` | **true** (unchanged — Phase 1K) |

---

## 6. Unit tests

```bash
npx vitest run src/lib/__tests__/phase1jBranchInventory.test.ts
```

**Covers:**

* CatType/ProType classification (no TrackStock column)  
* `INVENTORY_ALLOW_NEGATIVE_STOCK` env parsing  
* Migration SQL markers  
* Mutation service concurrency/idempotency  
* Sales integration without TblPro.Qty writes  
* Route BranchID rejection  
* Sale generation idempotency keys  
* **All 10 Phase 1J doc files exist**

**Regression suite (recommended with prior phases):**

```bash
npx vitest run \
  src/lib/__tests__/phase1jBranchInventory.test.ts \
  src/lib/__tests__/phase1iMultibranchBoundaries.test.ts \
  src/lib/__tests__/phase1hBranchSwitcher.test.ts \
  src/lib/__tests__/phase1gSecondBranchReadiness.test.ts
```

---

## 7. Migration runner

```bash
node scripts/audit-branches/run-phase1j-migration.cjs
```

Pre-capture audit:

```bash
node scripts/audit-branches/15-phase1j-inventory-before.cjs
```

---

## 8. What Phase 1J did **not** verify

| Item | Reason |
|---|---|
| Live PH1GTEST switch-in | Branch remains inactive |
| Transfer POST API | Not implemented |
| Purchase return API | Not implemented |
| `TblProMove` import | Explicitly excluded |
| HR / attendance migration | Out of scope |
| Sync restart | Forbidden |
| End-to-end UI inventory screen | API only |

---

## 9. Verification artifacts

| Artifact | Path |
|---|---|
| Pre-migration JSON | `scripts/audit-branches/_phase1j-inventory-before.json` |
| Pre-capture script | `scripts/audit-branches/15-phase1j-inventory-before.cjs` |
| Migration SQL | `db/migrations/add-branch-inventory-and-purchase-ownership.sql` |
| Migration runner | `scripts/audit-branches/run-phase1j-migration.cjs` |
| Mutation service | `src/lib/inventory/inventoryMutation.service.ts` |
| Product tracking | `src/lib/inventory/productTracking.ts` |
| Purchase service | `src/lib/inventory/purchaseInventory.service.ts` |
| Unit tests | `src/lib/__tests__/phase1jBranchInventory.test.ts` |

---

## 10. Acceptance criteria

- [x] Live DB facts captured on `last132`  
- [x] Migration applied; post counts match fingerprint  
- [x] Idempotent rerun OK  
- [x] No `TblProMove` import  
- [x] No PH1GTEST inventory rows  
- [x] No dual-write `TblPro.Qty`  
- [x] POS stock integration documented and tested  
- [x] Registry blocker cleared for inventory + purchases  
- [x] No claim of second branch activation  
- [x] No invented migrations beyond `add-branch-inventory-and-purchase-ownership.sql`
