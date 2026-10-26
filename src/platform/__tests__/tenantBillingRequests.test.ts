import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { availablePlanOffers, quoteTenantPlan, PlanRequestError } from '@/platform/commercial/planRequestPolicy';

function codeFrom(fn: () => unknown): string {
  try { fn(); } catch (err) { return err instanceof PlanRequestError ? err.code : 'UNKNOWN'; }
  return 'NO_ERROR';
}

const sub = { planCode: 'starter', revision: 3 };
const dbPlan = { planCode: 'growth', isPublic: true, isActive: true };

describe('tenant billing quote security', () => {
  it('quotes fixed server prices, monthly and annual, independent of requested amount', () => {
    expect(quoteTenantPlan('growth','monthly',sub,dbPlan)).toMatchObject({
      planCode:'growth', billingCycle:'monthly', amountEgp:899, currency:'EGP', subscriptionRevision:3,
    });
    expect(quoteTenantPlan('growth','annual',sub,dbPlan).amountEgp).toBe(8990);
  });

  it('never allows the internal plan or inactive/private plans', () => {
    expect(codeFrom(() => quoteTenantPlan('internal','monthly',sub,{planCode:'internal',isPublic:false,isActive:true}))).toBe('PLAN_UNAVAILABLE');
    expect(codeFrom(() => quoteTenantPlan('growth','monthly',sub,{...dbPlan,isActive:false}))).toBe('PLAN_UNAVAILABLE');
    expect(codeFrom(() => quoteTenantPlan('growth','monthly',sub,{...dbPlan,isPublic:false}))).toBe('PLAN_UNAVAILABLE');
  });

  it('rejects unsupported billing cycle and invalid subscription revision', () => {
    expect(codeFrom(() => quoteTenantPlan('growth','weekly',sub,dbPlan))).toBe('BILLING_CYCLE_INVALID');
    expect(codeFrom(() => quoteTenantPlan('growth','monthly',{...sub,revision:0},dbPlan))).toBe('SUBSCRIPTION_INVALID');
  });

  it('lists only active public plans present in DB with authoritative limits', () => {
    const rows = availablePlanOffers([
      { planCode:'starter',isPublic:true,isActive:true,displayName:'Starter',sortOrder:1,maxBranches:1,maxUsers:5,trialDays:14,pastDueGraceDays:7 },
      { planCode:'growth',isPublic:false,isActive:true,displayName:'Growth',sortOrder:2,maxBranches:3,maxUsers:20,trialDays:14,pastDueGraceDays:7 },
    ]);
    expect(rows.map((r) => r.planCode)).toEqual(['starter']);
    expect(rows[0]).toMatchObject({ maxBranches:1, maxUsers:5 });
  });

  it('disables legacy tier sales in the active tenant API while preserving historical reads', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(),p),'utf8');
    const route = read('src/app/api/tenant/billing/route.ts');
    const service = read('src/platform/commercial/planRequestService.ts');
    const admin = read('src/app/api/admin/platform/billing-requests/route.ts');
    expect(route.match(/requireTenantBillingAdmin\(\)/g)).toHaveLength(2);
    expect(route).toContain('getTenantSubscription(pool, auth.tenantId)');
    expect(route).toContain('getTenantPlanRequests(pool, auth.tenantId)');
    expect(route).not.toContain('submitTenantPlanRequest');
    expect(route).not.toContain('availablePlanOffers');
    expect(route).toContain('LEGACY_PLAN_REQUESTS_CLOSED');
    expect(route).toContain("subscriptionChanged: false");
    expect(route).toContain("newPaidRequestsEnabled: false");
    expect(service).not.toMatch(/UPDATE\s+dbo\.TenantSubscription/i);
    expect(service).toContain('acquireTenantApplock');
    expect(service).toContain('assertNotBootstrapTenant');
    expect(service).toContain('publishPlatformOutboxEvent');
    expect(admin.match(/await requirePlatformOperator\(\)/g)).toHaveLength(2);
    expect(admin).not.toContain('changeTenantPlan');
    expect(admin).not.toContain('transitionTenantSubscription');
    const ui = read('src/components/tenant/TenantBillingClient.tsx');
    expect(ui).not.toContain('data.plans.map');
    expect(ui).not.toContain('إرسال طلب الاشتراك');
  });

  it('billing stays accessible to expired trials while core app routes remain blocked', () => {
    const source = fs.readFileSync(path.join(process.cwd(),'src/components/tenant/TenantShellGate.tsx'),'utf8');
    expect(source.indexOf("pathname === '/admin/billing'")).toBeLessThan(source.indexOf("if (!snapshot.subscription.allowed)"));
    const auth = fs.readFileSync(path.join(process.cwd(),'src/platform/commercial/tenantBillingAuth.ts'),'utf8');
    expect(auth).toContain('authenticateTenantShell');
    expect(auth).toContain("auth.roles.some((r) => r === 'admin'");
  });
});
