import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkImportBoundaries } from '@/platform/internal/importBoundaries';
import { CASH_MOVE_MUTATION_PATTERN } from '@/apps/treasury/internal/cashMoveWriterAllowlist';

function listPosSourceFiles(): string[] {
  const root = path.join(process.cwd(), 'src/apps/pos');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

describe('DRVO-008 POS import boundaries', () => {
  it('production POS tree has no cross-app imports', () => {
    const violations = checkImportBoundaries(listPosSourceFiles());
    expect(violations).toEqual([]);
  });

  it('POS application code does not call Treasury MoneyMovement.post', () => {
    for (const file of listPosSourceFiles()) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content.includes('MoneyMovement'), `${file} must not reference Treasury MoneyMovement`).toBe(
        false,
      );
      expect(content.includes('createLegacyMoneyMovementAdapter'), file).toBe(false);
      expect(content.includes("reason: 'sale'"), file).toBe(false);
    }
  });

  it('sale create adapter does not manually insert initial sale CashMove', () => {
    const createAdapter = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/internal/legacySaleCreateAdapter.ts'),
      'utf8',
    );
    expect(createAdapter).toContain('InsCashMoveSales');
    expect(CASH_MOVE_MUTATION_PATTERN.test(createAdapter)).toBe(false);
  });

  it('POS update/delete CashMove writes stay on the legacy sale repository allowlist', () => {
    const repo = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/pos/internal/legacySaleRepository.ts'),
      'utf8',
    );
    expect(repo).toContain('INSERT INTO dbo.TblCashMove');
    expect(repo).toContain('DELETE FROM dbo.TblCashMove');
  });
});
