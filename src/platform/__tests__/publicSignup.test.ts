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

import {
  normalizeEgyptPhone,
  parsePublicSignupInput,
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
