import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('DRVO-010 POS sale Treasury mutation wiring', () => {
  it('updateSale wires Treasury replacer when mutation flag is enabled', () => {
    const src = read('src/apps/pos/application/updateSale.ts');
    expect(src).toContain('isPosSaleTreasuryMutationEnabled');
    expect(src).toContain('buildSaleCashMoveReplacer');
    expect(src).toContain('buildSaleTreasuryOwnershipProbe');
    expect(src).toContain('saleIsTreasuryOwned');
    expect(src).toContain('treasuryMutation');
  });

  it('deleteSale wires Treasury remover when mutation flag is enabled', () => {
    const src = read('src/apps/pos/application/deleteSale.ts');
    expect(src).toContain('isPosSaleTreasuryMutationEnabled');
    expect(src).toContain('buildSaleCashMoveRemover');
    expect(src).toContain('treasuryMutation');
  });

  it('extracted update hard-deletes legacy CashMove only when the sale is not treasury-owned', () => {
    const repo = read('src/apps/pos/internal/legacySaleRepository.ts');
    expect(repo).toContain('treasuryReplace');
    expect(repo).toContain('saleIsTreasuryOwned');
    expect(repo).toContain('reverseSplitPaymentTransfers');
    expect(repo).toContain('if (!treasuryOwned)');
    expect(repo).toContain('DELETE FROM dbo.TblCashMove WHERE invID = @invID');
    expect(repo).toContain('ISNULL(IsReversed, 0) = 0');
  });

  it('legacy repository uses treasury remove before legacy CashMove delete fallback', () => {
    const repo = read('src/apps/pos/internal/legacySaleRepository.ts');
    expect(repo).toContain('treasuryRemove');
    expect(repo).toContain('removed.treasuryOwned');
  });

  it('extracted update/delete application layers do not SQL-write TblCashMove', () => {
    for (const file of [
      'src/apps/pos/application/updateSale.ts',
      'src/apps/pos/application/deleteSale.ts',
    ]) {
      const src = read(file);
      expect(src).not.toMatch(/INSERT\s+INTO\s+(\[dbo\]\.)?\[?TblCashMove\]?/i);
      expect(src).not.toMatch(/DELETE\s+FROM\s+(\[dbo\]\.)?\[?TblCashMove\]?/i);
    }
  });

  it('pos-sale-treasury-mutation defaults to legacy rollout', () => {
    const manifest = read('src/platform/drvo/moduleManifest.ts');
    expect(manifest).toContain("module: 'pos-sale-treasury-mutation'");
    expect(manifest).toMatch(/pos-sale-treasury-mutation[\s\S]*?rollout:\s*'legacy'/);
  });
});
