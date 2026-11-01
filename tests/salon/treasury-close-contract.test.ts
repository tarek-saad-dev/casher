import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source contract regression gates; staging SQL E2E is still required for
// transaction rollback, lock contention and independent-tenant behavior.
const treasury = readFileSync(join(process.cwd(), 'src/lib/actions/treasuryActions.ts'), 'utf8');
const close = treasury.slice(treasury.indexOf('export async function closeTreasuryDay('), treasury.indexOf('function shiftCloseError('));
const operations = readFileSync(join(process.cwd(), 'src/modules/operations/infra/businessDayMutationTx.ts'), 'utf8');

describe('Salon treasury close invariants (#148)', () => {
  it('uses branch -> day locks and the shared transaction close', () => {
    expect(close.indexOf('lockBranchForDayMutation(connection, branchId)')).toBeGreaterThan(-1);
    expect(close.indexOf('lockBranchForDayMutation(connection, branchId)')).toBeLessThan(close.indexOf('const dayLookup ='));
    expect(close).toContain('closeBusinessDayInTransaction(connection, {');
    expect(close).toContain('forceCloseShifts: false');
    expect(close).not.toMatch(/UPDATE dbo\.TblNewDay[\s\S]*?SET Status\s*=\s*0/);
  });

  it('rejects duplicate day recons and validates methods before close', () => {
    expect(close).toContain('ShiftMoveID IS NULL');
    expect(close).toContain('const seenMethods = new Set<number>()');
    expect(close.indexOf('const seenMethods =')).toBeLessThan(close.indexOf('closeBusinessDayInTransaction(connection'));
    expect(close.indexOf('closeBusinessDayInTransaction(connection')).toBeLessThan(close.indexOf('INSERT INTO [dbo].[TblTreasuryCloseRecon]'));
  });

  it('inherits unfinished salon queue and open shift guards', () => {
    expect(operations).toContain('assertNoPendingSalonQueueAtClose(tx,');
    expect(operations).toContain('lockOpenShiftsForDay(tx, args.branchId, args.day.id)');
    expect(operations).toContain("'OPEN_SHIFTS'");
  });
});
