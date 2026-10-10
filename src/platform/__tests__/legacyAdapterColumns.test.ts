import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(rel: string): string {
  return readFileSync(rel, 'utf8');
}

describe('bootstrap seed and salon manifest load path', () => {
  it('seeds every TblBranch row and does not import the server-only platform barrel', () => {
    const seed = source('scripts/seed-drvo-003-bootstrap-tenant.ts');
    const manifest = source('src/packs/salon/manifest.ts');
    expect(seed).not.toContain('IsActive');
    expect(seed).toContain('FROM dbo.TblBranch');
    expect(seed).toContain('does not equal TblBranch count');
    expect(manifest).toContain("from '@/platform/registry/constants'");
    expect(manifest).not.toContain("@/platform/public");
  });
});

describe('legacy adapter columns match live tables', () => {
  it('customers read and write TblClient.Name and Mobile', () => {
    const src = source('src/shared/customers/internal/legacyAdapter.ts');
    expect(src).toContain('INSERT INTO dbo.TblClient (TenantId, [Name], Mobile, RegisterDate)');
    expect(src).toContain('WHERE TenantId = @tenantId AND Mobile = @phone');
    expect(src).toContain('SELECT ClientID, [Name], Mobile');
    expect(src).not.toContain('ClientName');
    expect(src).not.toContain('isDeleted');
  });

  it('catalog reads TblPro price and duration and treats TblCat as a category', () => {
    const src = source('src/shared/catalog/internal/legacyAdapter.ts');
    expect(src).toContain('SPrice1');
    expect(src).toContain('DurationMinutes');
    expect(src).toContain('LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID AND c.TenantId = p.TenantId');
    expect(src).not.toContain('ProPrice');
    expect(src).not.toContain('CatPrice');
    expect(src).not.toContain('FROM dbo.TblCat');
  });
});
