# Phase 1J Schema — Branch Inventory and Purchase Ownership

**Migration:** `db/migrations/add-branch-inventory-and-purchase-ownership.sql`  
**Runner:** `scripts/audit-branches/run-phase1j-migration.cjs`  
**Database:** cloud / `last132` only  
**GLEEM:** `WHERE BranchCode = N'GLEEM'` → live `BranchID = 1`

---

## 1. New tables

### `TblBranchInventory`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `BranchInventoryID` | INT IDENTITY | NOT NULL | — | PK |
| `BranchID` | INT | NOT NULL | — | FK → `TblBranch` |
| `ProID` | INT | NOT NULL | — | FK → `TblPro` |
| `QtyOnHand` | DECIMAL(10,2) | NOT NULL | 0 | Operational balance |
| `ReorderLevel` | DECIMAL(10,2) | NULL | — | Optional alert threshold |
| `LastMovementAt` | DATETIME2(0) | NULL | — | Updated on mutation |
| `CreatedAt` | DATETIME2(0) | NOT NULL | SYSUTCDATETIME() | |
| `UpdatedAt` | DATETIME2(0) | NOT NULL | SYSUTCDATETIME() | |
| `RowVer` | ROWVERSION | NOT NULL | — | Optimistic concurrency hint |

**Constraints:** `UQ_TblBranchInventory_Branch_Pro` UNIQUE `(BranchID, ProID)`

**Indexes:**

| Name | Definition |
|---|---|
| `IX_TblBranchInventory_Branch_Qty` | `(BranchID, QtyOnHand)` INCLUDE ProID, ReorderLevel |
| `IX_TblBranchInventory_Branch_Reorder` | `(BranchID, ReorderLevel, QtyOnHand)` WHERE ReorderLevel IS NOT NULL |

---

### `TblInventoryMovement` (append-only ledger)

| Column | Type | Null | Notes |
|---|---|---|---|
| `MovementID` | BIGINT IDENTITY | NOT NULL | PK |
| `BranchID` | INT | NOT NULL | FK → `TblBranch` |
| `ProID` | INT | NOT NULL | FK → `TblPro` |
| `QuantityDelta` | DECIMAL(10,2) | NOT NULL | **Must be ≠ 0** |
| `QuantityBefore` | DECIMAL(10,2) | NOT NULL | |
| `QuantityAfter` | DECIMAL(10,2) | NOT NULL | CHECK: After = Before + Delta |
| `MovementType` | NVARCHAR(40) | NOT NULL | See movement contract |
| `ReferenceType` | NVARCHAR(40) | NOT NULL | e.g. `SALE_INVOICE`, `PURCHASE` |
| `ReferenceID` | NVARCHAR(64) | NOT NULL | e.g. `مبيعات:1234` |
| `ReferenceLineID` | NVARCHAR(64) | NULL | Line disambiguator |
| `BusinessDayID` | INT | NULL | |
| `ShiftMoveID` | INT | NULL | |
| `UserID` | INT | NULL | |
| `Reason` | NVARCHAR(400) | NULL | |
| `IdempotencyKey` | NVARCHAR(120) | NOT NULL | **UNIQUE** |
| `ReversalOfMovementID` | BIGINT | NULL | FK → self |
| `CreatedAt` | DATETIME2(0) | NOT NULL | Default SYSUTCDATETIME() |

**Indexes:**

| Name | Definition |
|---|---|
| `IX_TblInventoryMovement_Branch_Pro_Created` | `(BranchID, ProID, CreatedAt DESC)` |
| `IX_TblInventoryMovement_Ref` | `(ReferenceType, ReferenceID)` |

---

### `TblInventoryTransfer` (schema only — no API in Phase 1J)

| Column | Notes |
|---|---|
| `TransferID` | PK |
| `FromBranchID`, `ToBranchID` | FK → `TblBranch`; CHECK distinct |
| `Status` | Default `DRAFT` |
| `RequestedBy`, `PostedBy`, `ReceivedBy` | INT NULL |
| `CreatedAt`, `PostedAt`, `ReceivedAt` | DATETIME2 |
| `Notes` | NVARCHAR(400) |
| `IdempotencyKey` | NVARCHAR(120) UNIQUE NULL |

### `TblInventoryTransferLine` (schema only)

| Column | Notes |
|---|---|
| `TransferLineID` | PK |
| `TransferID` | FK → transfer head |
| `ProID` | FK → `TblPro` |
| `Quantity` | CHECK > 0 |

---

## 2. Purchase head alterations

| Column | Pre | Post |
|---|---|---|
| `BranchID` | absent | **INT NOT NULL**, FK → `TblBranch` |
| `PostStatus` | absent | **NVARCHAR(30) NOT NULL**, default **`DRAFT`** |
| `ReturnOfPurchaseInvID` | absent | **INT NULL** (return linkage) |

**Index:** `IX_TblinvPurchaseHead_Branch_Date` on `(BranchID, invDate DESC)` INCLUDE invID, invType, PostStatus, GrandTotal

**Live row count before/after:** **0** — safe immediate NOT NULL without backfill guessing.

---

## 3. Deprecated column annotation

`TblPro.Qty` receives extended property:

> DEPRECATED Phase 1J — operational stock is TblBranchInventory.QtyOnHand. Do not use for POS.

Column **not dropped**. Application **must not** UPDATE `TblPro.Qty`.

---

## 4. Post-migration live counts

| Object | GLEEM (BranchID=1) | PH1GTEST (BranchID=2) |
|---|---:|---:|
| `TblBranchInventory` rows | **8** | **0** |
| `TblBranchInventory` qtySum | **0** | — |
| `TblInventoryMovement` rows | **0** | **0** |
| `TblinvPurchaseHead` rows | **0** | **0** |

Opening movements skipped: all `QtyOnHand = 0` → `QuantityDelta <> 0` CHECK prevents zero-delta `OPENING_BALANCE` rows. Balance rows are source of truth at zero.

---

## 5. Explicit non-changes

* No BranchID on `TblPro`, `TblProMove`, `TblinvPurchaseDetail`  
* No import of `TblProMove` (49 legacy rows unchanged)  
* No PH1GTEST inventory backfill  
* No HR / attendance columns  
* No sync registry changes  
* No activation of second branch
