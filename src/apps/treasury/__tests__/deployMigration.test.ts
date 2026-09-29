import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readDrvo007MigrationBatches } from '../../../../scripts/drvo007Migration';

describe('DRVO-007 production migration hook', () => {
  it('applies the idempotent registry script before casher restart', () => {
    const deploy = fs.readFileSync(path.join(process.cwd(), 'deploy/deploy-casher'), 'utf8');
    const migrate = deploy.indexOf('npm run treasury:migrate-drvo-007 -- --allow-production');
    const restart = deploy.indexOf('systemctl restart casher');
    expect(migrate).toBeGreaterThan(-1);
    expect(restart).toBeGreaterThan(migrate);
  });

  it('keeps the SQL migration idempotent with granular index and FK steps', () => {
    const batches = readDrvo007MigrationBatches().join('\n');
    expect(batches).toContain('TreasuryMovementRegistry');
    expect(batches).toContain('COL_LENGTH');
    expect(batches).toContain('ReversalOfCashMoveId');
    expect(batches).toContain('IsReversed');
    expect(batches).toContain('FK_TreasuryMovementRegistry_Tenant');
    expect(batches).toContain('sys.indexes');
  });
});
