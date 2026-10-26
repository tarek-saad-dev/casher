import fs from 'node:fs';import path from 'node:path';import {describe,it,expect} from 'vitest';
const src=fs.readFileSync(path.join(process.cwd(),'src/apps/treasury/internal/postSaleCashMove.ts'),'utf8');
describe('Treasury sale post direct idempotency and concurrency',()=>{
  it('takes a hold lock and returns prior movement before insert/savepoint',()=>{
    const helper=src.indexOf('export async function insertSaleCashMoveResolvingConflict');
    const lookup=src.indexOf('@existingCashMoveId = CashMoveId',helper);
    const savepoint=src.indexOf('SAVE TRANSACTION',helper);
    const insert=src.indexOf('INSERT INTO dbo.TblCashMove',helper);
    expect(lookup).toBeGreaterThan(helper);
    expect(lookup).toBeLessThan(savepoint);
    expect(savepoint).toBeLessThan(insert);
    expect(src).toContain('FROM dbo.TreasuryMovementRegistry WITH (UPDLOCK, HOLDLOCK)');
    expect(src).toContain("IF @existingCashMoveId IS NOT NULL");
    expect(src).toContain("SELECT N'replay' AS Outcome");
    expect(src).toContain('ExistingFingerprint');
    expect(src).toContain('new TreasuryIdempotencyConflictError()');
  });
});