import fs from 'node:fs';
import path from 'node:path';
import {describe,it,expect} from 'vitest';

describe('Salon POS -> Treasury transaction failure boundary',()=>{
  const file=fs.readFileSync(path.join(process.cwd(),'src/apps/pos/application/createSale.ts'),'utf8');
  it('authorizes and assembles the Treasury poster inside the rollback-protected try',()=>{
    const begin=file.indexOf('await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)');
    const protect=file.indexOf('  try {',begin);
    const auth=file.indexOf('await buildPosPortsForStaffUser(input.userID)');
    const adapter=file.indexOf('buildSaleCashMovePoster(ports.tenantId, ports.actor)');
    const save=file.indexOf('await executeLegacySaleCreateTransaction(',adapter);
    const commit=file.indexOf('await transaction.commit()',save);
    const rollback=file.indexOf('await transaction.rollback()',commit);
    expect(begin).toBeGreaterThan(0);
    expect(protect).toBeGreaterThan(begin);
    expect(auth).toBeGreaterThan(protect);
    expect(adapter).toBeGreaterThan(auth);
    expect(save).toBeGreaterThan(adapter);
    expect(commit).toBeGreaterThan(save);
    expect(rollback).toBeGreaterThan(commit);
    expect(file).toContain('if (isPosSaleTreasuryPostingEnabled())');
  });
});
