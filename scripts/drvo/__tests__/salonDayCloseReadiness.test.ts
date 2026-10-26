import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isIndependentSalonBranch, PENDING_SALON_QUEUE_STATUSES } from '../../../src/packs/salon/closeDayReadiness';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(),file),'utf8');

describe('Salon Pack branch day-close readiness', () => {
  it('targets independently provisioned salon branches without changing legacy CUT close', () => {
    expect(isIndependentSalonBranch('DRVO_0123456789_MAIN')).toBe(true);
    expect(isIndependentSalonBranch('drvo_abcdef1234_main')).toBe(true);
    expect(isIndependentSalonBranch('GLEEM')).toBe(false);
    expect(isIndependentSalonBranch('CAMP_CAESAR')).toBe(false);
    expect(isIndependentSalonBranch('DRVO_F00_MAIN')).toBe(false);
    expect(isIndependentSalonBranch('DRVO_ABCDEF1234_MAIN; DELETE')).toBe(false);
  });

  it('rejects any unfinished walk-in state, not terminal states', () => {
    expect(PENDING_SALON_QUEUE_STATUSES).toEqual(['waiting', 'called', 'arrived', 'in_service']);
    expect(PENDING_SALON_QUEUE_STATUSES).not.toContain('done');
    expect(PENDING_SALON_QUEUE_STATUSES).not.toContain('cancelled');
  });

  it('requires staging-only data and cleanup for the full daily close proof', () => {
    const smoke = read('scripts/drvo/salon-day-close-e2e-staging.ts');
    const workflow = read('.github/workflows/salon-day-close-staging-e2e.yml');
    expect(smoke).toContain("const EXPECTED_DB = 'last132_agent'");
    expect(smoke).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
    expect(smoke).toContain("pendingCloseCode === 'PENDING_QUEUE_TICKETS'");
    expect(smoke).toContain("await closeBusinessDay(closeCtx)");
    expect(smoke).toContain("SALON_DAY_CLOSE_E2E_STAGING_PASS");
    expect(smoke).toContain("await purgeSmokeTenant(pool, tenantCode)");
    expect(smoke).toContain("Synthetic queue ticket cleaned completely");
    expect(workflow).toContain("head.ref == 'agent/salon-day-close-guard'");
    expect(workflow).toContain('environment: drvo-staging');
    expect(workflow).not.toContain('deploy-vps');
  });

  it('checks queue status against BOTH active branch and business date inside the locked transaction', () => {
    const check = read('src/packs/salon/closeDayReadiness.ts');
    const tx = read('src/modules/operations/infra/businessDayMutationTx.ts');
    expect(check).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(check).toContain('BranchID = @branchId');
    expect(check).toContain('QueueDate = @workDate');
    expect(check).toContain("p.PackCode = N'salon'");
    expect(check).toContain('l.LegacyBranchId = @branchId');
    expect(check).toContain("AND Status IN ('waiting', 'called', 'arrived', 'in_service')");
    expect(check).toContain("'PENDING_QUEUE_TICKETS'");
    expect(tx).toContain('businessDate: args.day.newDay');
    expect(tx).toContain('assertNoPendingSalonQueueAtClose(tx, {');
    expect(tx).toContain('branchCode: branchContext.branchCode');
    // Existing scheduled reconciliation is not changed; scope is manual close.
    expect(tx).toContain('export async function executeReconcileBusinessDay(');
  });
});
