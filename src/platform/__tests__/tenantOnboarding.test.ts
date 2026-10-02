import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertValidTenantCode,
  normalizeTenantCode,
  rejectSystemControlledFields,
} from '@/platform/onboarding/validation';
import { TenantOnboardingError } from '@/platform/onboarding/errors';

describe('DRVO-011 tenant onboarding validation', () => {
  it('accepts canonical tenant codes and rejects reserved CASHER_BOOT', () => {
    expect(assertValidTenantCode('drvo011_smoke')).toBe('DRVO011_SMOKE');
    expect(() => assertValidTenantCode('CASHER_BOOT')).toThrow(TenantOnboardingError);
    expect(() => assertValidTenantCode('ab')).toThrow(TenantOnboardingError);
  });

  it('rejects browser-supplied system fields', () => {
    expect(() =>
      rejectSystemControlledFields({ tenantId: 'x' }, ['tenantId']),
    ).toThrow(TenantOnboardingError);
  });

  it('normalizes tenant codes', () => {
    expect(normalizeTenantCode(' salon_a ')).toBe('SALON_A');
  });
});

describe('DRVO-011 platform operator route wiring', () => {
  it('protects tenant control-plane routes with requirePlatformOperator', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/platform/tenants/route.ts'),
      'utf8',
    );
    const readiness = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/api/admin/platform/tenants/[tenantId]/readiness/route.ts',
      ),
      'utf8',
    );
    expect(route).toContain('requirePlatformOperator');
    expect(readiness).toContain('requirePlatformOperator');
    expect(route).toContain('rejectSystemControlledFields');
  });
});

describe('DRVO-011 tenant provisioning service', () => {
  it('does not default branch template source to GLEEM', () => {
    const branchProvision = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/branch/branchProvisioningService.ts'),
      'utf8',
    );
    expect(branchProvision).not.toContain("|| 'GLEEM'");
  });

  it('uses generic salon pack seeding without CUT template copy', () => {
    const provision = fs.readFileSync(
      path.join(process.cwd(), 'src/platform/onboarding/provisionTenant.ts'),
      'utf8',
    );
    expect(provision).toContain('seedTenantRegistry');
    expect(provision).not.toMatch(/copyFromBranchCode|seedPartnerShares|CAMP_CAESAR/);
    expect(provision).not.toMatch(/['"]GLEEM['"]/);
    expect(provision).toContain("eventType: 'tenant.provisioned'");
  });
});

describe('DRVO-011 multi-tenant bootstrap characterization', () => {
  it('verifies CASHER_BOOT specifically and allows additional tenants', () => {
    const bootstrap = fs.readFileSync(
      path.join(process.cwd(), 'scripts/drvo/platformBootstrap.ts'),
      'utf8',
    );
    expect(bootstrap).toContain('findBootstrapTenantId');
    expect(bootstrap).not.toContain('second tenant forbidden');
    expect(bootstrap).not.toContain('Expected one Tenant row');
    expect(bootstrap).toContain('Branch belongs to another tenant');
  });
});
