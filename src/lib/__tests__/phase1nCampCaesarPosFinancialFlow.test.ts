import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1N Camp Caesar POS financial flow', () => {
  it('requires real invoice head not CashMove-only substitute', () => {
    const runner = read('scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts');
    expect(runner).toContain('TblinvServHead');
    expect(runner).toContain('TblinvServDetail');
    expect(runner).toContain('pos.cashInvoice');
    expect(runner).toContain('pos.cardInvoice');
    expect(runner).toContain('InsCashMoveSales');
    expect(runner).toContain('Full POS invoice path did not create BranchID=3 CashMove');
  });

  it('sales API uses trigger CashMove path', () => {
    const sales = read('src/app/api/sales/route.ts');
    expect(sales).toContain('InsCashMoveSales');
    expect(sales).toContain('Do NOT manually insert here');
  });
});
