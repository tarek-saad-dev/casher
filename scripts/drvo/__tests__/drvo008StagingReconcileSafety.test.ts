import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const get = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), name), 'utf8');

describe('DRVO-008 stale staging invoice reconciliation is narrowly guarded', () => {
  const recovery = get('scripts/drvo/drvo008-staging-fixture-reconcile.ts');
  const gate = get('.github/workflows/drvo-staging-gate.yml');

  it('refuses production and checks the exact staging database/login before any SQL modification', () => {
    expect(recovery).toContain("const DB = 'last132_agent'");
    expect(recovery).toContain("const LOGIN = 'drvo_agent'");
    expect(recovery).toContain("process.env.DB_DATABASE !== 'last132'");
    expect(recovery).toContain("process.env.CLOUD_DB_NAME !== 'last132'");
    expect(recovery).toContain('SUSER_SNAME() AS LoginName');
    expect(recovery).toContain("connection.recordset[0].Db === DB");
    expect(recovery).toContain('protected staging SQL secret missing');
    expect(recovery.indexOf('database identity changed or permission mismatch'))
      .toBeLessThan(recovery.indexOf('const candidates ='));
  });

  it('defaults to read-only, and only recovers clients with TWO synthetic markers', () => {
    expect(recovery).toContain('const doApply = process.argv.includes');
    expect(recovery).toContain('--apply-staging-fixture-recovery');
    expect(recovery).toContain('if (!doApply) {');
    expect(recovery).toContain('synthetic clients/invoices remain');
    expect(recovery).toContain("const SYNTHETIC = 'DRVO008-SMOKE'");
    expect(recovery).toContain("c.Name=N'${SYNTHETIC}' AND c.Notes=N'${SYNTHETIC}'");
    expect(recovery).toContain('candidates.recordset.length <= 20');
  });

  it('rejects unmarked sales, foreign membership/branch, and unproven financial cleanup', () => {
    for (const guard of [
      'ownedSales.recordset.length <= 1',
      'marker === EXTRACTED || marker === LEGACY',
      'dbo.TblinvServHead h WITH (UPDLOCK, HOLDLOCK)',
      'l.LegacyBranchId=h.BranchID AND l.TenantId=@tenant',
      'm.TenantId=@tenant AND m.LegacyUserId=h.UserID',
      "h.Notes2=@marker",
      "await legacy.deleteInvoice(tx, invId, branchId)",
      "await deleteSale(tx, invId, branchId, userId)",
      'await tx.rollback()',
      'financial residues after synthetic invoice deletion',
      'refusing client cleanup while invoice remains',
      'synthetic client cleanup verification failed',
    ]) expect(recovery).toContain(guard);
  });

  it('recovers before the real test, then audits after, never asserts green after a residue', () => {
    const start = gate.indexOf('name: DRVO-008 reconcile prior synthetic staging fixtures (guarded)');
    const smoke = gate.indexOf('name: CUT POS both-writer real sale staging smoke (legacy and extracted)');
    const audit = gate.indexOf('name: DRVO-008 assert no synthetic staging invoice/client residues');
    const done = gate.indexOf('name: Report PASS');
    expect(start).toBeGreaterThan(0);
    expect(smoke).toBeGreaterThan(start);
    expect(audit).toBeGreaterThan(smoke);
    expect(done).toBeGreaterThan(audit);
    expect(gate).toContain('scripts/drvo/drvo008-staging-fixture-reconcile.ts --apply-staging-fixture-recovery');
    expect(gate).toContain('run: npx tsx scripts/drvo/drvo008-staging-fixture-reconcile.ts');
  });
});
