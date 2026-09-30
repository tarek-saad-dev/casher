import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('DRVO-008 POS port wiring', () => {
  it('POST /api/sales uses extracted POS path when flag is on', () => {
    const route = read('src/app/api/sales/route.ts');
    const legacy = read('src/lib/sales/legacyRouteSaleCreate.ts');
    expect(route).toContain('isPosPortEnabled');
    expect(route).toContain('createSale');
    expect(route).toContain('createSaleLegacyFromRoute');
    expect(route).toContain("@/lib/sales/legacyRouteSaleCreate");
    expect(route).not.toContain('@/apps/pos/internal/');
    expect(legacy).toContain('ISOLATION_LEVEL.SERIALIZABLE');
    expect(legacy).not.toMatch(/return createSale\s*\(/);
    expect(legacy).not.toContain("from '../application/createSale'");
    expect(legacy).not.toContain("from '@/apps/pos/application/createSale'");
  });

  it('PUT/DELETE /api/sales/[id] keep an independent legacy invoice implementation', () => {
    const route = read('src/app/api/sales/[id]/route.ts');
    const legacy = read('src/lib/actions/invoiceActions.ts');
    expect(route).toContain('isPosPortEnabled');
    expect(route).toContain('updateSale');
    expect(route).toContain('deleteSale');
    expect(route).toContain('getSaleSnapshot');
    expect(route).toContain("from '@/lib/actions/invoiceActions'");
    expect(route).toContain('updateInvoice');
    expect(route).toContain('deleteInvoice');
    expect(route).toContain('getInvoiceSnapshot');
    expect(legacy).toContain('export async function updateInvoice');
    expect(legacy).toContain('export async function deleteInvoice');
    expect(legacy).toContain('export async function getInvoiceSnapshot');
    expect(legacy).not.toContain('@/apps/pos');
    expect(legacy).not.toContain('legacySaleRepository');
  });
});
