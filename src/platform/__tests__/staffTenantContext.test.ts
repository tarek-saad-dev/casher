import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('staff tenant context', () => {
  it('documents legacy super_admin as tenant owner, not platform admin', () => {
    const note = fs.readFileSync(
      path.join(process.cwd(), 'docs/drvo/DRVO-003-IMPLEMENTATION-NOTE.md'),
      'utf8',
    );
    expect(note).toContain('super_admin');
    expect(note).toMatch(/not\*?\*?\s*platform admin/i);
  });

  it('api-auth exposes tenantId and membershipId resolution', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/api-auth.ts'),
      'utf8',
    );
    expect(src).toContain('tenantId: string | null');
    expect(src).toContain('membershipId: string | null');
    expect(src).toContain('resolveStaffTenantContext');
  });
});
