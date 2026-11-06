import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  isStockTrackedProduct,
} from '@/lib/inventory/productTracking';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Retail products & inventory module', () => {
  it('keeps alphanumeric product codes including punctuation in reference catalog', () => {
    const catalog = read('src/lib/inventory/productCatalog.service.ts');
    expect(catalog).toContain("code: 'LH.5097'");
    expect(catalog).toContain("code: 'ML147#'");
    expect(catalog).toContain("code: 'LK0068'");
    expect(catalog).toContain('SUPPLIER_CATALOG_REFERENCE');
    const codeMatches = catalog.match(/code: '[^']+'/g) || [];
    expect(codeMatches.length).toBeGreaterThanOrEqual(19);
  });

  it('retail products remain stock-tracked via CatType/ProType contract', () => {
    expect(isStockTrackedProduct({ proId: 1, proType: 'pro', catType: null })).toBe(true);
    expect(isStockTrackedProduct({ proId: 2, proType: null, catType: 'pro' })).toBe(true);
    expect(isStockTrackedProduct({ proId: 3, proType: 'serv', catType: 'serv' })).toBe(false);
  });

  it('DRVO-022 migration registers ProductCode uniqueness and stock policy', () => {
    const sql = read('db/drvo-migrations/022-retail-product-catalog/schema.sql');
    expect(sql).toContain('ProductCode');
    expect(sql).toContain('UQ_TblPro_Tenant_ProductCode');
    expect(sql).toContain('TblInventoryStockPolicy');
    expect(sql).toContain('UnitCostSnapshot');
    expect(sql).not.toMatch(/UPDATE\s+.*TblPro\.Qty/i);
    expect(sql).not.toMatch(/SET\s+Qty\s*=/i);

    const mig = read('scripts/drvo/migrations/022-retail-product-catalog.ts');
    expect(mig).toContain("migrationKey: 'retail-product-catalog'");
    expect(mig).toContain('migrationId: 22');

    const index = read('scripts/drvo/migrations/index.ts');
    expect(index).toContain('retailProductCatalogMigration');
  });

  it('stock count idempotency includes quantity-before', () => {
    const svc = read('src/lib/inventory/purchaseInventory.service.ts');
    expect(svc).toContain('quantityBeforeForKey');
    expect(svc).toMatch(/ADJ_SET:\$\{args\.branchId\}:\$\{args\.proId\}:\$\{quantityBeforeForKey\}/);
    expect(svc).toContain('postPurchaseReturn');
  });

  it('branch inventory GET lists tracked products without requiring balance rows', () => {
    const route = read('src/app/api/inventory/branch/route.ts');
    expect(route).toContain('LEFT JOIN dbo.TblBranchInventory');
    expect(route).toContain('ISNULL(bi.QtyOnHand, 0)');
    expect(route).toContain('BranchID في الطلب غير مسموح');
    expect(route).not.toMatch(/FROM dbo\.TblBranchInventory bi\s+INNER JOIN dbo\.TblPro/);
  });

  it('sale paths map EmpID 0 to NULL and snapshot unit cost', () => {
    const create = read('src/apps/pos/internal/legacySaleCreateAdapter.ts');
    expect(create).toContain('retailEmp');
    expect(create).toContain('unitCost');
    expect(create).toContain('UnitCostSnapshot');
    expect(create).toContain('applySaleStockDecrements');

    const legacy = read('src/lib/sales/legacyRouteSaleCreate.ts');
    expect(legacy).toContain('retailEmp');
    expect(legacy).toContain('applySaleStockDecrements');
  });

  it('insufficient stock messages include product and branch context', () => {
    const mut = read('src/lib/inventory/inventoryMutation.service.ts');
    expect(mut).toContain('الكمية المتاحة من');
    expect(mut).toContain('productName');
    expect(mut).toContain('branchName');
    expect(mut).toContain('allowNegativeStockForTenant');
  });

  it('transfer service uses TRANSFER_OUT/IN with idempotent receive', () => {
    const xfer = read('src/lib/inventory/transferInventory.service.ts');
    expect(xfer).toContain("movementType: 'TRANSFER_OUT'");
    expect(xfer).toContain("movementType: 'TRANSFER_IN'");
    expect(xfer).toContain('TRANSFER_IN:${args.transferId}');
    expect(xfer).toContain('IN_TRANSIT');
  });

  it('admin products and inventory UI routes exist', () => {
    expect(fs.existsSync(path.join(root, 'src/app/admin/products/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/admin/inventory/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/components/pos/luxury/ProductCatalog.tsx'))).toBe(true);
    const nav = read('src/components/layout/nav-config.ts');
    expect(nav).toContain('/admin/products');
    expect(nav).toContain('/admin/inventory');
  });

  it('POS page exposes products catalog tab', () => {
    const pos = read('src/app/income/pos/page.tsx');
    expect(pos).toContain('ProductCatalog');
    expect(pos).toMatch(/products/);
    expect(pos).toContain('/api/inventory/branch');
  });
});
