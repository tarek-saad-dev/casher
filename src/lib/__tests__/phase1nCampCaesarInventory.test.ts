import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Phase 1N Camp Caesar inventory', () => {
  it('runner adjusts BranchID=3 stock and checks GLEEM unchanged', () => {
    const runner = read('scripts/branch-smoke/run-phase1n-camp-caesar-smoke.ts');
    expect(runner).toContain('applyManualStockAdjustment');
    expect(runner).toContain('applyInventoryMutation');
    expect(runner).toContain('GLEEM inventory qty changed');
    expect(runner).toContain('inventory.adjustment');
    expect(runner).toContain('inventory.consumption');
    expect(runner).toContain('BRANCH_ID = 3');
  });

  it('mutation service never falls back to another branch qty', () => {
    const mut = read('src/lib/inventory/inventoryMutation.service.ts');
    expect(mut).toContain('never fall back to another branch');
    expect(mut).toContain('BranchID = @branchId AND ProID = @proId');
  });
});
