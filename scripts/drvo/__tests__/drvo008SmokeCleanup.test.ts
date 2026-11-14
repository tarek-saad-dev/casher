import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'scripts/drvo-008-pos-staging-smoke.ts'),
  'utf8',
);

describe('DRVO-008 staging smoke never hides financial failures behind cleanup', () => {
  it('keeps the selected tenant/cashier identity available outside the smoke body', () => {
    expect(source).toContain('let smokeUserId: number | null = null;');
    expect(source).toContain('let smokeTenantId: string | null = null;');
    expect(source).toContain('smokeUserId = userId;');
    expect(source).toContain('smokeTenantId = tenantId;');
    const cleanup = source.slice(source.indexOf('} finally {', source.indexOf('DRVO-008 POS staging smoke complete')));
    expect(cleanup).not.toMatch(/deleteSale\([^;]*\buserId\b/);
    expect(cleanup).toContain('smokeUserId');
  });

  it('always logs the actual SQL failure before cleanup and refuses silent cleanup success', () => {
    expect(source).toContain('DRVO-008 PRIMARY FAILURE (before cleanup)');
    expect(source).toContain('DRVO-008 CLEANUP FAILURE');
    expect(source).toContain('DRVO-008 NO-GO: staging fixture not fully reconciled');
    expect(source).toContain('process.exitCode = 1');
    expect(source).toContain('staging SQL pool close timed out');
    expect(source).toContain('process.exit(1)');
  });

  it('cleans only one verified staging client/invoice, using its writer-specific delete path', () => {
    for(const fragment of [
      "createdWriter = 'extracted'",
      "createdWriter = 'legacy'",
      'createdWriter === \'legacy\'',
      'await legacyInvoice.deleteInvoice(cleanupTx, createdInvId, createdBranchId)',
      'await deleteSale(cleanupTx, createdInvId, createdBranchId, smokeUserId)',
      'c.Name=N\'DRVO008-SMOKE\'',
      'c.Notes=N\'DRVO008-SMOKE\'',
      'h.Notes2=@marker',
      'l.TenantId=@tenantId',
      'c.TenantId=@tenantId',
      'cleanup financial residual proof failed',
      'await cleanupTx.rollback()',
      'cleanup refused: synthetic client ownership mismatch',
      'cleanup refused: synthetic client still has a paid invoice',
    ]) {
      expect(source).toContain(fragment);
    }
  });

  it('does not normalize broken staging fixtures or drop the original tenant/service constraints', () => {
    expect(source).toContain('WHERE p.TenantId = @tenantId');
    expect(source).toContain('e.TenantId = @tenantId');
    expect(source).toContain('ea.EffectiveFrom <= @day');
    expect(source).toContain('pm.TenantId = l.TenantId');
    expect(source).toContain("DB_DATABASE: STAGING_DB");
    expect(source).toContain("if (db === PRODUCTION_DB) fail('refusing production last132')");
    expect(source).not.toContain('INSERT INTO dbo.TblEmpBranchAssignment');
  });
});
