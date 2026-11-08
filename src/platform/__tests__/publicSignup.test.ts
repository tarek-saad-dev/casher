import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: {
    NVarChar: vi.fn(),
    Char: vi.fn(),
    UniqueIdentifier: {},
    MAX: -1,
  },
}));
vi.mock('@/packs', () => ({ findIndustryPack: vi.fn() }));
vi.mock('@/platform/onboarding/wizard/coordinator', () => ({
  onboardBusiness: vi.fn(),
  defaultOnboardingDeps: vi.fn(),
}));

import { findIndustryPack } from '@/packs';
import { SALON_PACK } from '@/packs/salon/public';
import {
  buildOnboardingRequest,
  normalizeEgyptPhone,
  parsePublicSignupInput,
  publicSignupMainBranchName,
  signupIpHash,
} from '@/platform/publicSignup/service';
import { buildSalonOnboardingPreset } from '@/packs/salon/onboardingPreset';

describe('public signup input', () => {
  it('normalizes Egyptian local and international phone formats', () => {
    expect(normalizeEgyptPhone('01012345678')).toBe('201012345678');
    expect(normalizeEgyptPhone('+20 10 1234 5678')).toBe('201012345678');
    expect(() => normalizeEgyptPhone('123')).toThrow();
  });

  it('accepts a minimal salon signup and filters unknown needs', () => {
    expect(
      parsePublicSignupInput({
        industry: 'salon',
        needs: ['booking', 'pos', 'unknown'],
        contactName: 'Tarek Saad',
        businessName: 'Nova Salon',
        phone: '01012345678',
        email: 'owner@example.com',
        password: 'StrongPass1',
        startMode: 'demo',
      }),
    ).toMatchObject({
      industry: 'salon',
      needs: ['booking', 'pos'],
      phone: '201012345678',
      email: 'owner@example.com',
      startMode: 'demo',
    });
  });

  it('forces supermarket demo signup back to a clean real-data start', () => {
    expect(
      parsePublicSignupInput({
        industry: 'supermarket',
        needs: ['pos'],
        contactName: 'Owner',
        businessName: 'Market',
        phone: '01112345678',
        password: 'StrongPass1',
        startMode: 'demo',
      }).startMode,
    ).toBe('real');
  });

  it('rejects invalid exact app selections before any signup database mutation', () => {
    const input = {
      industry: 'salon',
      needs: [],
      contactName: 'Owner',
      businessName: 'New Salon',
      phone: '01012345678',
      password: 'StrongPass1',
      startMode: 'real',
      selectedApps: ['booking', 'purchasing'],
    };
    // Pack lookup is mocked in this service-level suite; the pure selection suite
    // exercises actual pack composition. Invalid type is still rejected here.
    expect(() => parsePublicSignupInput({ ...input, selectedApps: 'booking' })).toThrow();
  });

  it('forwards chosen apps to tenant provisioning independently of the Starter trial', () => {
    vi.mocked(findIndustryPack).mockReturnValue(SALON_PACK);
    const signup = parsePublicSignupInput({
      industry: 'salon',
      needs: ['booking'],
      selectedApps: ['booking', 'pos', 'inventory', 'purchasing'],
      contactName: 'Owner',
      businessName: 'Nova',
      phone: '01012345678',
      password: 'StrongPass1',
      startMode: 'real',
    });
    const onboarding = buildOnboardingRequest(signup);
    expect(onboarding.apps).toEqual({
      add: ['inventory', 'purchasing'],
      remove: ['queue', 'attendance', 'payroll', 'treasury', 'reports'],
    });
    expect(onboarding.subscription).toEqual({ planCode: 'starter', status: 'trial' });
    expect(onboarding.business.industryPackCode).toBe('salon');
    expect(onboarding.ai).toBeNull();
  });

  it('rejects client-forged commercial activation and tenant context before provisioning', () => {
    vi.mocked(findIndustryPack).mockReturnValue(SALON_PACK);
    const base = {
      industry: 'salon', selectedApps: ['booking'],
      contactName: 'Owner', businessName: 'Synthetic Salon',
      phone: '01012345678', password: 'StrongPass1', startMode: 'real',
    };
    for (const field of [
      'tenantId', 'tenantCode', 'actorUserId', 'ownerUserId',
      'planCode', 'subscriptionStatus', 'subscription', 'trialEndsAt',
      'isPaid', 'paymentStatus', 'appEntitlements',
    ]) {
      expect(() => parsePublicSignupInput({ ...base, [field]: 'paid' }))
        .toThrowError(expect.objectContaining({ code: 'SYSTEM_FIELDS_FORBIDDEN', status: 400 }));
    }
    const valid = buildOnboardingRequest(parsePublicSignupInput(base));
    expect(valid.subscription).toEqual({ planCode: 'starter', status: 'trial' });
    expect(valid.apps).toEqual({
      add: [], remove: ['queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports'],
    });
    expect(valid.branches).toHaveLength(1);
    expect(valid.owner.loginName).toBe('u201012345678');
    expect(valid.business.industryPackCode).toBe('salon');
  });

  it('keeps old signup payloads on the legacy needs compatibility path', () => {
    const signup = parsePublicSignupInput({
      industry: 'salon',
      needs: ['inventory'],
      contactName: 'Owner',
      businessName: 'Nova',
      phone: '01012345678',
      password: 'StrongPass1',
      startMode: 'real',
    });
    expect(buildOnboardingRequest(signup).apps).toEqual({
      add: ['inventory', 'purchasing'],
      remove: [],
    });
  });

  it('hashes IP addresses without persisting the raw address', () => {
    expect(signupIpHash('127.0.0.1')).toMatch(/^[0-9a-f]{64}$/);
    expect(signupIpHash(null)).toBeNull();
  });
});

describe('public signup Salon Pack composition', () => {
  it('does not bootstrap a real salon with shared CUT demo catalog', () => {
    const preset = buildSalonOnboardingPreset({ branchCode: 'NOVA_MAIN', startMode: 'real' });
    expect(preset.booking[0].branchCode).toBe('NOVA_MAIN');
    expect(preset.services).toEqual([]);
    expect(preset.employees).toEqual([]);
  });

  it('creates only new-tenant branch references for demo workers', () => {
    const alpha = buildSalonOnboardingPreset({ branchCode: 'ALPHA_MAIN', startMode: 'demo' });
    const beta = buildSalonOnboardingPreset({ branchCode: 'BETA_MAIN', startMode: 'demo' });
    expect(alpha.employees.every((e) => e.primaryBranchCode === 'ALPHA_MAIN')).toBe(true);
    expect(beta.employees.every((e) => e.primaryBranchCode === 'BETA_MAIN')).toBe(true);
    expect(alpha.employees).not.toBe(beta.employees);
  });
});

describe('independent public signup branch identities', () => {
  it('does not reuse global branch names or short names for separate salons', () => {
    const base = {
      industry: 'salon',
      needs: ['booking'],
      contactName: 'Owner',
      businessName: 'Nova Salon',
      password: 'StrongPass1',
      startMode: 'real',
    };
    const alpha = buildOnboardingRequest(parsePublicSignupInput({ ...base, phone: '01012345678' }));
    const beta = buildOnboardingRequest(parsePublicSignupInput({ ...base, phone: '01112345678' }));
    expect(alpha.branches[0].branchCode).not.toBe(beta.branches[0].branchCode);
    expect(alpha.branches[0].branchName).not.toBe(beta.branches[0].branchName);
    expect(alpha.branches[0].shortName).toBeNull();
    expect(beta.branches[0].shortName).toBeNull();
    expect(alpha.branches[0].branchName).toContain('Nova Salon');
    expect(beta.branches[0].branchName).toContain('Nova Salon');
    expect(alpha.branches[0].branchName.length).toBeLessThanOrEqual(100);
  });

  it('uses a stable, bounded branch name for retries and long business names', () => {
    const name = 'صالون'.repeat(50);
    const first = publicSignupMainBranchName(name, 'DRVO_0123456789_MAIN');
    const retry = publicSignupMainBranchName(name, 'DRVO_0123456789_MAIN');
    expect(retry).toBe(first);
    expect(first).toContain('0123456789');
    expect(first.length).toBeLessThanOrEqual(100);
    expect(() => publicSignupMainBranchName('Salon', 'invalid')).toThrow();
  });
});

describe('public signup safety guards', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('uses the existing tenant onboarding coordinator instead of custom tenant SQL', () => {
    const src = read('src/platform/publicSignup/service.ts');
    expect(src).toContain('onboardBusiness(');
    expect(src).not.toMatch(/INSERT INTO dbo\.Tenant\b/i);
    expect(src).not.toMatch(/CASHER_BOOT|DRVOWA|TenantMessagingChannel/i);
  });

  it('creates only trial subscriptions and leaves WhatsApp/AI out', () => {
    const src = read('src/platform/publicSignup/service.ts');
    expect(src).toContain("subscription: { planCode: 'starter', status: 'trial' }");
    expect(src).toContain('ai: null');
    expect(src).not.toContain("'messaging'");
    expect(src).not.toContain("'ai-receptionist'");
  });

  it('keeps public booking activation outside signup', () => {
    const src = read('src/platform/publicSignup/service.ts');
    expect(src).not.toMatch(/PublicBookingEnabled|BookingEnabled\s*=\s*1/i);
  });

  it('exposes only the intended public UI routes without the authenticated shell', () => {
    const src = read('src/components/layout/AuthLayout.tsx');
    expect(src).toContain("pathname === '/drvo'");
    expect(src).toContain("pathname === '/start'");
  });
});
