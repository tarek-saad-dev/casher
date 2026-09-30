import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DRVO-009 sale Treasury posting integration', () => {
  it('create adapter posts Treasury sale CashMove only behind pos-sale-treasury flag', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/internal/legacySaleCreateAdapter.ts'),
      'utf8',
    );
    expect(src).toContain('postSaleCashMove');
    expect(src).not.toMatch(/INSERT\s+INTO\s+(\[dbo\]\.)?\[?TblCashMove\]?/i);
    expect(src).not.toContain('@/apps/treasury');
  });

  it('createSale wires treasury poster via lib composition when flag enabled', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/application/createSale.ts'),
      'utf8',
    );
    expect(src).toContain('isPosSaleTreasuryPostingEnabled');
    expect(src).toContain('buildSaleCashMovePoster');
    expect(src).not.toContain('createLegacyMoneyMovementAdapter');
    expect(src).not.toContain('@/apps/treasury');
  });

  it('generic MoneyMovement.post still rejects sale reasons', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/treasury/internal/postMovement.ts'),
      'utf8',
    );
    expect(src).toContain('isSaleReason');
    expect(src).toContain('InsCashMoveSales');
  });
});
