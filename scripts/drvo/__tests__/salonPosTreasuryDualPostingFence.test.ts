import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
const source = fs.readFileSync(path.join(process.cwd(), 'src/apps/pos/internal/legacySaleCreateAdapter.ts'), 'utf8');

describe('Salon POS/Treasury dual writer rollout safety', () => {
  it('fails within the sale transaction when extracted posting and trigger create duplicate primary movements', () => {
    const post = source.indexOf('await input.postSaleCashMove(transaction');
    const head = source.indexOf('await headReq.query(');
    const fence = source.indexOf('SELECT COUNT_BIG(*) AS MovementCount');
    const detail = source.indexOf('let detailCount = 0;');
    expect(post).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(post);
    expect(fence).toBeGreaterThan(head);
    expect(fence).toBeLessThan(detail);
    expect(source).toContain('if (input.postSaleCashMove) {\n    const movements');
    expect(source).toContain('AND BranchID = @saleBranchID');
    expect(source).toContain('if (count !== 1)');
    expect(source).toContain('POS_TREASURY_POSTING_MISMATCH');
    expect(source).toContain('WITH (UPDLOCK, HOLDLOCK)');
  });
});
