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

  it('POS application and public code do not write Treasury, payroll, or loyalty tables', () => {
    const forbidden = [
      /TblCashMove/i,
      /TblLoyalty/i,
      /TblEmpTarget/i,
      /TblEmpLedger/i,
      /MoneyMovement/,
      /sp_Loyalty_/,
    ];
    const roots = ['src/apps/pos/application', 'src/apps/pos/public'];
    for (const rootRel of roots) {
      const root = path.join(process.cwd(), rootRel);
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
            const content = fs.readFileSync(full, 'utf8');
            for (const pattern of forbidden) {
              expect(pattern.test(content), `${full} matches ${pattern}`).toBe(false);
            }
          }
        }
      };
      walk(root);
    }
  });

  it('documents named legacy seams that may touch CashMove or loyalty', () => {
    const seams = [
      'src/apps/pos/internal/legacySaleRepository.ts',
      'src/apps/pos/internal/legacySaleCreateAdapter.ts',
      'src/apps/pos/internal/salePostCommitEffects.ts',
      'src/apps/pos/internal/legacyBookingConversionAdapter.ts',
    ];
    const createAdapter = fs.readFileSync(
      path.join(process.cwd(), seams[1]),
      'utf8',
    );
    const postCommit = fs.readFileSync(path.join(process.cwd(), seams[2]), 'utf8');
    const conversion = fs.readFileSync(path.join(process.cwd(), seams[3]), 'utf8');
    expect(CASH_MOVE_MUTATION_PATTERN.test(createAdapter)).toBe(false);
    expect(createAdapter).not.toContain('MoneyMovement');
    expect(postCommit).toContain('sp_Loyalty_EarnPointsFromSale');
    expect(postCommit).not.toContain('MoneyMovement');
    expect(CASH_MOVE_MUTATION_PATTERN.test(postCommit)).toBe(false);
    expect(conversion).not.toContain('TblCashMove');
    expect(conversion).not.toContain('TblLoyalty');
    expect(conversion).not.toContain('MoneyMovement');
    expect(seams).toHaveLength(4);
  });
});
