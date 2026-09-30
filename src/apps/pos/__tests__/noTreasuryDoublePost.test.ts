import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DRVO-008 sale create must not double-post cash', () => {
  it('create adapter documents trigger-only initial CashMove', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/internal/legacySaleCreateAdapter.ts'),
      'utf8',
    );
    expect(src).toContain('InsCashMoveSales');
    expect(src).not.toContain('MoneyMovement');
    expect(src).not.toContain('createLegacyMoneyMovementAdapter');
    expect(src).not.toMatch(/INSERT\s+INTO\s+(\[dbo\]\.)?\[?TblCashMove\]?/i);
  });

  it('createSale application does not invoke treasury composition', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/application/createSale.ts'),
      'utf8',
    );
    expect(src).not.toContain('treasury');
    expect(src).not.toContain('MoneyMovement');
  });
});
