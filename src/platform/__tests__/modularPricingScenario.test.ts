import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateSalonResearchScenario, ResearchScenarioError, SALON_RESEARCH_APP_OPTIONS } from '@/platform/commercial/modularPricingScenario';

const defaultInput = {
  industry: 'salon', apps: ['booking','pos','queue'], branches: 1,
  cycle: 'monthly' as const,
};
function rejection(input: Parameters<typeof calculateSalonResearchScenario>[0]): string {
  try { calculateSalonResearchScenario(input); } catch (err) {
    return err instanceof ResearchScenarioError ? err.code : 'UNEXPECTED_ERROR';
  }
  return 'NO_ERROR';
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('DRVO tierless modular pricing research-only safety', () => {
  it('computes a non-payable itemized monthly experimental scenario', () => {
    const s=calculateSalonResearchScenario(defaultInput);
    expect(s).toMatchObject({
      mode:'research_only',currency:'EGP',industry:'salon',cycle:'monthly',
      canCheckout:false,canActivate:false,monthlyEgp:597,illustrativePeriodEgp:597,
      branches:1,yearlyMonthsCharged:10,
    });
    expect(s.lines.map(x=>x.code)).toEqual(['booking','pos','queue']);
    expect(s.lines.reduce((a,x)=>a+x.monthlyEgp,0)).toBe(s.monthlyEgp);
  });
  it('counts extra branches once and presents annual amount as explicitly experimental', () => {
    const s=calculateSalonResearchScenario({ ...defaultInput,branches:3,cycle:'annual' });
    expect(s.lines.find(x=>x.code==='extra-branch')).toMatchObject({quantity:2,monthlyEgp:398});
    expect(s.monthlyEgp).toBe(995);
    expect(s.illustrativePeriodEgp).toBe(9950);
    expect(s.canCheckout).toBe(false);
  });
  it('rejects duplicate apps, missing required booking and unsupported counts', () => {
    expect(rejection({ ...defaultInput,apps:['booking','booking'] })).toBe('APPS_DUPLICATED');
    expect(rejection({ ...defaultInput,apps:['pos'] })).toBe('REQUIRED_APP_MISSING');
    expect(rejection({ ...defaultInput,apps:['booking'],branches:0 })).toBe('BRANCH_COUNT_INVALID');
    expect(rejection({ ...defaultInput,apps:['booking'],branches:11 })).toBe('BRANCH_COUNT_INVALID');
    expect(rejection({ ...defaultInput,industry:'supermarket' })).toBe('INDUSTRY_UNSUPPORTED');
    expect(rejection({ ...defaultInput,cycle:'weekly' as 'monthly' })).toBe('CYCLE_INVALID');
  });
  it('never prices unsafe or commercially unverified apps as free', () => {
    for(const app of ['inventory','purchasing','messaging','ai-receptionist','loyalty','nonexistent']) {
      expect(rejection({...defaultInput,apps:['booking',app]})).toBe('APP_NOT_PRICEABLE');
    }
    expect(SALON_RESEARCH_APP_OPTIONS.every(x=>!['inventory','purchasing','messaging','ai-receptionist','loyalty'].includes(x.code))).toBe(true);
  });
  it('research API is operator-only and has no writes, collections or subscription activation', () => {
    const route=read('src/app/api/admin/platform/modular-pricing-preview/route.ts');
    const page=read('src/app/platform/modular-pricing/page.tsx');
    const calc=read('src/platform/commercial/modularPricingScenario.ts');
    expect(route).toContain('requirePlatformOperator()');
    expect(page).toContain('requirePlatformOperator()');
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).not.toContain('UPDATE dbo.');
    expect(route).not.toContain('INSERT INTO');
    expect(route).not.toContain('changeTenantPlan');
    expect(route).not.toContain('paymentProvider');
    expect(calc).toContain("canCheckout: false");
    expect(calc).toContain("canActivate: false");
  });
  it('stops selling obsolete tiers to tenants and on the public landing', () => {
    const route=read('src/app/api/tenant/billing/route.ts');
    const ui=read('src/components/tenant/TenantBillingClient.tsx');
    const landing=read('src/app/drvo/page.tsx');
    expect(route).toContain('LEGACY_PLAN_REQUESTS_CLOSED');
    expect(route).not.toContain('submitTenantPlanRequest');
    expect(route).toContain('getTenantPlanRequests(pool, auth.tenantId)');
    expect(ui).not.toContain('data.plans.map');
    expect(landing).not.toContain('const PLANS');
    expect(landing).not.toContain("name: 'Starter'");
    expect(landing).not.toContain("name: 'Growth'");
    expect(landing).not.toContain("name: 'Pro'");
  });
});
