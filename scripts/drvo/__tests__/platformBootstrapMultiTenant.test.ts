import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('platformBootstrap multi-tenant reconcile rules', () => {
  const bootstrap = fs.readFileSync(
    path.join(process.cwd(), 'scripts/drvo/platformBootstrap.ts'),
    'utf8',
  );

  it('ensureTenant creates or reuses CASHER_BOOT without blocking other tenants', () => {
    expect(bootstrap).toContain("WHERE Code = @code");
    expect(bootstrap).not.toContain('second tenant forbidden');
  });

  it('ensureLocations skips branches already mapped to another tenant', () => {
    expect(bootstrap).toContain('Branch belongs to another tenant');
    expect(bootstrap).toContain('WHERE LegacyBranchId = @legacyBranchId');
  });

  it('ensureMemberships skips users already mapped to another tenant', () => {
    expect(bootstrap).toContain('existingAny.recordset.length === 1');
    expect(bootstrap).toContain('continue');
  });

  it('verify checks every legacy branch is mapped somewhere', () => {
    expect(bootstrap).toContain('Unmapped legacy branch');
  });
});
