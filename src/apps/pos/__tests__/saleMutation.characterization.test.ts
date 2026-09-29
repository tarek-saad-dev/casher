import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function sqlBlock(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const end = src.indexOf('`);', start);
  expect(end, marker).toBeGreaterThan(start);
  return src.slice(start, end).replace(/\s+/g, ' ').trim();
}

describe('DRVO-008 sale mutation characterization', () => {
  const extracted = read('src/apps/pos/internal/legacySaleCreateAdapter.ts');
  const legacy = read('src/lib/sales/legacyRouteSaleCreate.ts');
  const repo = read('src/apps/pos/internal/legacySaleRepository.ts');

  it('legacy and extracted create use the same header, detail, and payment SQL', () => {
    for (const marker of [
      'INSERT INTO [dbo].[TblinvServHead]',
      'INSERT INTO [dbo].[TblinvServDetail]',
      'INSERT INTO [dbo].[TblinvServPayment]',
    ]) {
      expect(sqlBlock(legacy, marker)).toBe(sqlBlock(extracted, marker));
    }
  });

  it('create keeps stock decrement, trigger CashMove, split redistribution, and target enqueue', () => {
    for (const src of [extracted, legacy]) {
      expect(src).toContain('allocateInvID');
      expect(src).toContain('applySaleStockDecrements');
      expect(src).toContain('InsCashMoveSales');
      expect(src).toContain('redistributeFromClearing');
      expect(src).toContain('enqueueTargetRecalcFromInvoiceSnapshots');
      expect(src).toContain("reason: 'invoice_create'");
      expect(src).not.toContain('MoneyMovement');
      expect(src).not.toMatch(/INSERT\s+INTO\s+(\[dbo\]\.)?\[?TblCashMove\]?/i);
    }
    expect(read('src/apps/pos/application/createSale.ts')).toContain('SERIALIZABLE');
    expect(legacy).toContain('SERIALIZABLE');
  });

  it('update keeps stock reversal, detail replacement, payments, and CashMove rewrite', () => {
    expect(repo).toContain('reverseSaleStockMovements');
    expect(repo).toContain('applySaleStockDecrements');
    expect(repo).toContain('DELETE FROM dbo.TblinvServDetail');
    expect(repo).toContain('DELETE FROM dbo.TblinvServPayment');
    expect(repo).toContain('INSERT INTO dbo.TblinvServPayment');
    expect(repo).toContain('INSERT INTO dbo.TblCashMove');
    expect(repo).toContain('UPDATE dbo.TblinvServHead SET');
    expect(read('src/apps/pos/application/updateSale.ts')).toContain('updateInvoice');
  });

  it('delete keeps stock reversal, CashMove cleanup, and loyalty ledger cleanup', () => {
    expect(repo).toContain('reverseSaleStockMovements');
    expect(repo).toContain('DELETE FROM dbo.TblCashMove WHERE InvID = @id');
    expect(repo).toContain('DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @id');
    expect(repo).toContain('DELETE FROM dbo.TblinvServDetail');
    expect(repo).toContain('DELETE FROM dbo.TblinvServHead');
    expect(read('src/apps/pos/application/deleteSale.ts')).toContain('deleteInvoice');
  });
});
