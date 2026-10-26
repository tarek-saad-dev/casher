import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(),file),'utf8');

describe('Salon daily close checklist', () => {
  it('is scoped to active authorized branch, never takes branchId from request', () => {
    const route = read('src/app/api/operations/day-close-readiness/route.ts');
    expect(route).toContain('requireBranchOperationAccess()');
    expect(route).toContain('getSalonCloseReadiness(branch)');
    expect(route).not.toContain('searchParams');
    expect(route).not.toContain('request.json(');
    expect(route).toContain("status: 500");
  });

  it('shows queue, shift and treasury status without mutating finances', () => {
    const implementation = read('src/packs/salon/closeReadiness.ts');
    expect(implementation).toContain('BranchID = @branchId AND QueueDate = @workDate');
    expect(implementation).toContain('BranchID = @branchId AND BusinessDayID = @dayId');
    expect(implementation).toContain('BranchID = @branchId AND NewDay = @dayId');
    expect(implementation).toContain("Status IN ('waiting', 'called', 'arrived', 'in_service')");
    expect(implementation).toContain("code: 'TREASURY_UNRECONCILED'");
    expect(implementation).toContain('blocking: false');
    expect(implementation).toContain('treasuryReconciliationRecorded');
    expect(implementation).not.toContain('readyForFinalClose');
    expect(implementation).not.toContain('UPDATE dbo.');
  });

  it('retains the transaction-level close guard separately from read-only preflight', () => {
    const transaction = read('src/modules/operations/infra/businessDayMutationTx.ts');
    expect(transaction).toContain('assertNoPendingSalonQueueAtClose(tx');
    expect(transaction).toContain('lockOpenShiftsForDay(tx, args.branchId, args.day.id)');
  });
});
