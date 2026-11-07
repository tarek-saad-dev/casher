# Retail Products & Inventory — Deployment / Activation Checklist

## Before merge

- [ ] PR open against `main` on branch `feat/retail-products-inventory`
- [ ] Targeted tests green: `npx vitest run src/lib/__tests__/retailProductsInventory.test.ts src/lib/__tests__/phase1jBranchInventory.test.ts`
- [ ] No production DB access during implementation
- [ ] Agents never merge

## Staging (last132_agent only)

1. Apply DRVO migrations:
   ```bash
   npm run drvo:migrate -- --expected-database=last132_agent
   ```
2. Verify migration `retail-product-catalog` (022):
   ```bash
   npm run drvo:verify
   ```
3. Smoke:
   - Create product with code `LH.5097` (alphanumeric + punctuation)
   - Confirm new product shows qty 0 on `/admin/inventory` without inventing stock
   - Post purchase receipt → qty increases
   - POS منتجات tab sells product without barber; stock decrements once
   - Insufficient stock (after activating strict mode) returns Arabic message and preserves cart
   - Physical count twice with intervening sale creates two adjustments
   - Transfer: create → post (source out) → receive (dest in); double receive is no-op
   - Import preview for 19-SKU reference; commit only after admin confirm; no opening qty

## Production migration (human)

1. Open PR remains open
2. Run production migration PLAN via `.github/workflows/drvo-production-migration.yml`
3. Human approves APPLY for exact PR head SHA + manifest digest
4. Verify `retail-product-catalog` applied
5. Human merges PR → deploy workflow runs automatically

## Strict non-negative activation (after opening stock)

Do **not** flip env/`AllowNegativeStock` until:

1. Opening stock registered (`TblInventoryStockPolicy.OpeningStockRegistered = 1`) via admin inventory policy or counts/purchases
2. Negative balances listed and reconciled to ≥ 0
3. Admin activates strict mode from `/admin/inventory` policy panel (`activateStrictMode`)
4. Confirm sales blocked with message like:  
   `الكمية المتاحة من المنتج 2 فقط في فرع جليم.`

Optional env pin: `INVENTORY_ALLOW_NEGATIVE_STOCK=false` (tenant policy still authoritative once activated).

## Explicit non-actions

- Do not seed the 19-SKU catalog automatically against production
- Do not write `TblPro.Qty`
- Do not invent opening quantities on product create
- Do not merge as an agent
