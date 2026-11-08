# Retail Products & Inventory — Implementation Audit

**Date:** 2026-11-07  
**Branch:** `feat/retail-products-inventory`  
**Scope:** Extend Phase 1J branch inventory into a production retail module (no parallel stock system).

---

## 1. Existing working functionality

| Area | Status | Location |
|------|--------|----------|
| Stock-tracked classification | Working | `productTracking.ts` — `CatType='pro'` OR `ProType IN ('pro','product')` |
| Branch balances | Working | `TblBranchInventory` keyed `(BranchID, ProID)` |
| Append-only ledger | Working | `TblInventoryMovement` + `applyInventoryMutation` |
| Sale stock decrement | Working | Modular `createSale` and `createSaleLegacyFromRoute` both call `applySaleStockDecrements` |
| Sale update/delete reverse | Working | `invoiceActions` / `legacySaleRepository` reverse + re-apply with generation |
| Purchase draft/post | Working | `POST /api/purchases` + `postPurchaseReceipt` (stock only on POSTED) |
| Manual adjust API | Working | `POST /api/inventory/branch` — session branch only; rejects body BranchID |
| Transfer tables | Schema only | `TblInventoryTransfer` / `TblInventoryTransferLine` |
| Catalog identity | Working | `TblPro` GLOBAL_MASTER (Barcode, PPrice, SPrice1, ImageUrl, ProNameAr, ProType) |
| Image upload infra | Working for services | Cloudinary `services/` folder; reusable for products |

---

## 2. Missing functionality (pre-implementation)

1. Dedicated `/admin/products` catalog UI (SKU, brand, units, import/export).
2. Dedicated `/admin/inventory` hub (KPIs, low/out stock, movements, counts, transfers).
3. ProductCode/SKU and related catalog columns on `TblPro`.
4. Branch inventory GET lists only rows with a balance — products without a balance row are invisible.
5. Inter-branch transfer API/UI (create → post → receive).
6. Purchase return API/UI.
7. Customer return stock restore path (beyond invoice delete/edit).
8. POS Services/Products toggle, stock badges, product lines without barber.
9. Safe transition to strict non-negative stock (opening + reconciliation + activation).
10. Product profitability reports using cost snapshots.
11. Supplier catalog import preview/confirm (19-SKU reference).
12. Weighted-average / snapshot cost policy documentation + persistence.

---

## 3. Bugs and contract gaps

| Issue | Impact | Fix direction |
|-------|--------|---------------|
| `ADJ_SET:{branch}:{pro}:{target}:{reason}` stock-count idempotency | Repeating identical count after intervening sales silently skips | Include quantity-before in idempotency key |
| `GET /api/inventory/branch` INNER JOIN balances | Missing products appear absent instead of qty 0 | LEFT JOIN from tracked catalog |
| `INVENTORY_ALLOW_NEGATIVE_STOCK` default true | Oversell allowed indefinitely | Tenant policy gate after opening/reconciliation |
| Insufficient-stock Arabic message too generic | Cashiers lack qty/branch context | Include product + available qty + branch name |
| POS requires barber for all catalog items | Retail cannot sell without assigning EmpID | Product lines: null EmpID, Bonus 0 |
| No ProductCode uniqueness | Alphanumeric SKUs (LH.5097, ML147#) unsupported as first-class codes | Tenant-scoped unique `ProductCode` |
| Purchase return / transfer movements unused | Contract types exist but no writers | Implement via mutation service only |
| Cost = mutable `PPrice` only | Historical profit drifts when catalog cost changes | Snapshot unit cost on sale/purchase lines |

---

## 4. Reusable services (do not duplicate)

- `applyInventoryMutation` / `applySaleStockDecrements` / `reverseSaleStockMovements`
- `postPurchaseReceipt` / `applyManualStockAdjustment`
- `isStockTrackedProduct` / `INVENTORY_MOVEMENT_TYPES`
- `requireBranchOperationAccess` / `resolveBranchDayAndShiftForWrite`
- Cloudinary upload helpers (extend with `products/` folder)
- Admin RTL patterns from `/admin/services`
- DRVO migration manifest (`scripts/drvo/migrations`)

**Forbidden:** writing `TblPro.Qty`, direct `UPDATE TblBranchInventory` outside mutation service, client-supplied BranchID for mutations, dual stock ledgers.

---

## 5. Required database migrations

DRVO migration `022-retail-product-catalog`:

| Change | Purpose |
|--------|---------|
| `TblPro.ProductCode` NVARCHAR(40) NULL | Alphanumeric SKU |
| Unique filtered index `(TenantId, ProductCode)` | Tenant-scoped uniqueness |
| `TblPro.Brand`, `Description`, `StockUnit`, `UnitsPerPack`, `SuggestedRetailPrice`, `MinStockThreshold`, `SupplierRef` | Catalog fields |
| `TblPro.CreatedAt`, `TblPro.UpdatedAt` | Audit timestamps |
| `TblInventoryStockPolicy` | Opening / reconciliation / strict mode per tenant |
| Ensure transfer status CHECK covers DRAFT/POSTED/IN_TRANSIT/RECEIVED/CANCELLED | Transfer workflow |

No opening quantities invented. No production seed of the 19-SKU supplier sheet.

---

## 6. Implementation phases (this PR)

1. Schema + catalog service + `/admin/products`
2. Branch inventory listing fix + `/admin/inventory`
3. POS products tab + sale contract (null EmpID, stock messages)
4. Strict stock policy activation workflow
5. Purchases UI completion + purchase returns
6. Transfer create/post/receive
7. Profit reports + import preview
8. Tests + activation checklist
