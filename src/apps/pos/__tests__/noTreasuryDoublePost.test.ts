import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DRVO-008/009 sale create must not double-post cash', () => {
  it('create adapter never direct-inserts TblCashMove', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/internal/legacySaleCreateAdapter.ts'),
      'utf8',
    );
    expect(src).toContain('InsCashMoveSales');
    expect(src).not.toContain('createLegacyMoneyMovementAdapter');
    expect(src).not.toMatch(/INSERT\s+INTO\s+(\[dbo\]\.)?\[?TblCashMove\]?/i);
  });

  it('Treasury sale posting is injected via optional poster callback', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/internal/legacySaleCreateAdapter.ts'),
      'utf8',
    );
    expect(src).toContain('postSaleCashMove');
    expect(src).not.toContain('@/apps/treasury');
  });
});
