import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  allowNegativeStock,
  isStockTrackedProduct,
} from '@/lib/inventory/productTracking';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1J branch inventory', () => {
  it('classifies stock tracking from CatType/ProType without TrackStock column', () => {
    expect(
      isStockTrackedProduct({ proId: 1, proType: 'pro', catType: 'pro' }),
    ).toBe(true);
    expect(
      isStockTrackedProduct({ proId: 2, proType: null, catType: 'pro' }),
    ).toBe(true);
    expect(
      isStockTrackedProduct({ proId: 3, proType: 'serv', catType: 'serv' }),
    ).toBe(false);
    expect(
      isStockTrackedProduct({ proId: 4, proType: null, catType: 'serv' }),
    ).toBe(false);
  });

  it('negative-stock policy is explicit (continuity default true)', () => {
    const prev = process.env.INVENTORY_ALLOW_NEGATIVE_STOCK;
    delete process.env.INVENTORY_ALLOW_NEGATIVE_STOCK;
    expect(allowNegativeStock()).toBe(true);
    process.env.INVENTORY_ALLOW_NEGATIVE_STOCK = 'false';
    expect(allowNegativeStock()).toBe(false);
    process.env.INVENTORY_ALLOW_NEGATIVE_STOCK = 'true';
    expect(allowNegativeStock()).toBe(true);
    if (prev === undefined) delete process.env.INVENTORY_ALLOW_NEGATIVE_STOCK;
    else process.env.INVENTORY_ALLOW_NEGATIVE_STOCK = prev;
  });

  it('migration creates branch inventory and purchase BranchID', () => {
    const sql = read('db/migrations/add-branch-inventory-and-purchase-ownership.sql');
    expect(sql).toContain('TblBranchInventory');
    expect(sql).toContain('TblInventoryMovement');
    expect(sql).toContain('UQ_TblBranchInventory_Branch_Pro');
    expect(sql).toContain('TblinvPurchaseHead');
    expect(sql).toContain('BranchID');
    expect(sql).toContain("BranchCode = N'GLEEM'");
    expect(sql).toMatch(/PH1GTEST must not receive/i);
    expect(sql).toContain('TblInventoryTransfer');
  });

  it('inventory mutation service is the sole stock write entry and never writes TblPro.Qty', () => {
    const svc = read('src/lib/inventory/inventoryMutation.service.ts');
    expect(svc).toContain('UPDLOCK');
    expect(svc).toContain('HOLDLOCK');
    expect(svc).toContain('IdempotencyKey');
    expect(svc).not.toMatch(/UPDATE\s+dbo\.TblPro/i);
    expect(svc).not.toMatch(/TblPro\.Qty/i);

    const sales = read('src/app/api/sales/route.ts');
    expect(sales).toContain('applySaleStockDecrements');
    expect(sales).not.toMatch(/UPDATE\s+.*TblPro[\s\S]{0,80}Qty/i);

    const invActions = read('src/lib/actions/invoiceActions.ts');
    expect(invActions).toContain('reverseSaleStockMovements');
    expect(invActions).toContain('applySaleStockDecrements');
  });

  it('purchase and inventory routes reject body BranchID and use session branch', () => {
    const purchases = read('src/app/api/purchases/route.ts');
    expect(purchases).toContain('resolveBranchDayAndShiftForWrite');
    expect(purchases).toContain('BranchID في الطلب غير مسموح');
    expect(purchases).toContain('postPurchaseReceipt');

    const inv = read('src/app/api/inventory/branch/route.ts');
    expect(inv).toContain('requireBranchOperationAccess');
    expect(inv).toContain('BranchID في الطلب غير مسموح');
    expect(inv).toContain('applyManualStockAdjustment');
  });

  it('sale idempotency keys include generation for update cycles', () => {
    const svc = read('src/lib/inventory/inventoryMutation.service.ts');
    expect(svc).toContain('g${generation}');
    expect(svc).toContain('SALE_REVERSAL');
    expect(svc).toContain('ReversalOfMovementID');
  });

  it('Phase 1J documentation set exists', () => {
    const docs = [
      'docs/branch-phase-1j-inventory-dependency-audit.md',
      'docs/branch-phase-1j-product-tracking-contract.md',
      'docs/branch-phase-1j-schema.md',
      'docs/branch-phase-1j-stock-movement-contract.md',
      'docs/branch-phase-1j-purchases-and-returns.md',
      'docs/branch-phase-1j-pos-stock-integration.md',
      'docs/branch-phase-1j-transfer-contract.md',
      'docs/branch-phase-1j-migration-and-backfill.md',
      'docs/branch-phase-1j-verification.md',
      'docs/branch-phase-1j-closure.md',
    ];
    for (const d of docs) {
      expect(fs.existsSync(path.join(root, d)), d).toBe(true);
    }
  });
});
