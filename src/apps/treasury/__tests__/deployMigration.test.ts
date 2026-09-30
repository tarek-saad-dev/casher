import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readDrvo007MigrationBatches } from '../../../../scripts/drvo007Migration';

describe('DRVO production migration hook', () => {
  it('keeps application deploy read-only for DRVO migrations and verifies before restart', () => {
    const deploy = fs.readFileSync(path.join(process.cwd(), 'deploy/deploy-casher'), 'utf8');
    const verify = deploy.indexOf('npm run drvo:verify');
    const restart = deploy.indexOf('systemctl restart casher');
    expect(deploy).not.toContain('npm run drvo:migrate-production');
    expect(verify).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(verify);
  });

  it('keeps treasury SQL migration idempotent in drvo-migrations path', () => {
    const batches = readDrvo007MigrationBatches().join('\n');
    expect(batches).toContain('TreasuryMovementRegistry');
    expect(batches).toContain('COL_LENGTH');
    expect(batches).toContain('ReversalOfCashMoveId');
    expect(batches).toContain('IsReversed');
  });
});
