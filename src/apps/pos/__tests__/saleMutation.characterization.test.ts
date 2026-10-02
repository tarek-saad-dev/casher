import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function sqlBlock(src: string, marker: string): string {
  const blocks = sqlBlocks(src, marker);
  expect(blocks.length, marker).toBeGreaterThan(0);
  return blocks[0]!;
}

function sqlBlocks(src: string, marker: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (from < src.length) {
    const start = src.indexOf(marker, from);
    if (start < 0) break;
    const end = src.indexOf('`);', start);
    expect(end, marker).toBeGreaterThan(start);
    blocks.push(src.slice(start, end).replace(/\s+/g, ' ').trim());
    from = end + 3;
  }
  return blocks;
}

describe('DRVO-008 sale mutation characterization', () => {
  const extracted = read('src/apps/pos/internal/legacySaleCreateAdapter.ts');
  const legacy = read('src/lib/sales/legacyRouteSaleCreate.ts');
  const repo = read('src/apps/pos/internal/legacySaleRepository.ts');
  const legacyInvoice = read('src/lib/actions/invoiceActions.ts');

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

  it('flag-off update and delete keep their own copy of the pre-extraction SQL', () => {
    expect(legacyInvoice).not.toContain('@/apps/pos');
    for (const marker of [
      'UPDATE dbo.TblinvServHead SET',
      'DELETE FROM dbo.TblinvServDetail',
      'INSERT INTO dbo.TblCashMove',
      'DELETE FROM dbo.TblCashMove WHERE InvID = @id',
      'DELETE FROM dbo.TblLoyaltyPointLedger WHERE SourceInvID = @id',
    ]) {
      expect(sqlBlock(legacyInvoice, marker)).toBe(sqlBlock(repo, marker));
    }
  });

  it('flag-off split update insert lists BranchID and BusinessDayID for every value', () => {
    const repoInserts = sqlBlocks(repo, 'INSERT INTO dbo.TblCashMove');
    const legacyInserts = sqlBlocks(legacyInvoice, 'INSERT INTO dbo.TblCashMove');
    expect(repoInserts).toHaveLength(2);
    expect(legacyInserts).toHaveLength(2);
    expect(repoInserts[1]).toBe(legacyInserts[1]);
    expect(repoInserts[1]).toContain('ShiftMoveID, BranchID, BusinessDayID');
    expect(repoInserts[1]).toContain('@ShiftMoveID, @BranchID, @BusinessDayID');
  });
});
