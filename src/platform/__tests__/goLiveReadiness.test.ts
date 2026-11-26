import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ getPool: vi.fn(), sql: {} }));
vi.mock('@/platform/apps/tenantApps', () => ({
  listTenantApps: vi.fn(),
  installedAppCodes: vi.fn(),
}));
vi.mock('@/platform/commercial/commercialAccess', () => ({
  evaluateCommercialAccess: vi.fn(),
}));

import { buildGoLiveMilestones } from '@/platform/onboarding/goLiveReadiness';

describe('customer go-live milestones', () => {
  it('requires the operational chain through first sale and booking when booking is installed', () => {
    const milestones = buildGoLiveMilestones({
      commercialAllowed: true,
      activeBranches: 1,
      catalogItems: 4,
      employees: 2,
      users: 2,
      businessDays: 1,
      shifts: 1,
      sales: 1,
      bookings: 0,
      bookingInstalled: true,
    });
    const byId = Object.fromEntries(milestones.map((m) => [m.id, m.status]));
    expect(byId).toMatchObject({
      commercial_access: 'done',
      active_branch: 'done',
      catalog: 'done',
      team: 'done',
      users: 'done',
      business_day: 'done',
      first_shift: 'done',
      first_sale: 'done',
      first_booking: 'pending',
    });
  });

  it('does not block a non-booking tenant on the booking milestone', () => {
    const milestones = buildGoLiveMilestones({
      commercialAllowed: true,
      activeBranches: 1,
      catalogItems: 1,
      employees: 1,
      users: 1,
      businessDays: 1,
      shifts: 1,
      sales: 1,
      bookings: 0,
      bookingInstalled: false,
    });
    expect(milestones.find((m) => m.id === 'first_booking')?.status).toBe('not_applicable');
    expect(milestones.filter((m) => m.status === 'pending')).toHaveLength(0);
  });

  it('keeps pre-operation tenants visibly incomplete', () => {
    const milestones = buildGoLiveMilestones({
      commercialAllowed: true,
      activeBranches: 1,
      catalogItems: 4,
      employees: 2,
      users: 2,
      businessDays: 0,
      shifts: 0,
      sales: 0,
      bookings: 0,
      bookingInstalled: true,
    });
    expect(milestones.filter((m) => m.status === 'pending').map((m) => m.id)).toEqual(
      expect.arrayContaining(['business_day', 'first_shift', 'first_sale', 'first_booking']),
    );
  });
});

describe('go-live control-plane guards', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('protects the go-live route with platform-operator auth', () => {
    const route = read('src/app/api/admin/platform/tenants/[tenantId]/go-live/route.ts');
    expect(route).toContain('requirePlatformOperator');
    expect(route).toContain('invalidTenantIdResponse');
  });

  it('scopes transactional milestone queries through the tenant Location mapping', () => {
    const src = read('src/platform/onboarding/goLiveReadiness.ts');
    expect(src).toContain('l.TenantId = @tenantId');
    expect(src).toMatch(/TblNewDay[\s\S]*Location/);
    expect(src).toMatch(/TblShiftMove[\s\S]*Location/);
    expect(src).toMatch(/TblinvServHead[\s\S]*Location/);
    expect(src).toMatch(/Bookings[\s\S]*Location/);
  });

  it('does not enable public booking or messaging as part of go-live tracking', () => {
    const src = read('src/platform/onboarding/goLiveReadiness.ts');
    expect(src).not.toMatch(/UPDATE\s+dbo\.TblBranch/i);
    expect(src).not.toMatch(/TenantMessagingChannel|DRVOWA/i);
  });
});

import { buildAnalytics,parseAnalyticsPeriod } from '@/platform/onboarding/analyticsModel';
describe('onboarding analytics cohort',()=>{
  const empty={submitted:0,provisioned:0,failed:0,provisioning:0,branch:0,catalog:0,team:0,day:0,shift:0,sold:0,booked:0,firstSaleDaysTotal:0,firstSaleMeasured:0};
  it('uses a bounded period and null for missing denominators',()=>{
    expect(parseAnalyticsPeriod(null)).toBe(30);
    expect(parseAnalyticsPeriod('90')).toBe(90);
    expect(()=>parseAnalyticsPeriod('365')).toThrow();
    expect(buildAnalytics(empty)).toMatchObject({conversion:null,provisioningRate:null,meanCalendarDaysToFirstSale:null});
  });
  it('separates actual sales conversion from cumulative setup and calculates approximate average',()=>{
    const result=buildAnalytics({...empty,submitted:20,provisioned:15,failed:4,provisioning:1,branch:12,catalog:10,team:9,day:8,shift:6,sold:9,booked:5,firstSaleDaysTotal:12,firstSaleMeasured:8});
    expect(result.conversion).toBe(60);
    expect(result.provisioningRate).toBe(75);
    expect(result.meanCalendarDaysToFirstSale).toBe(1.5);
    expect(result.stages.find(x=>x.id==='branch')?.waiting).toBe(3);
    expect(result.stages.find(x=>x.id==='shift')?.count).toBe(6);
  });
  it('uses operator authorization, real salon cohorts, aggregate-only data and tenant ownership',()=>{
    const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
    const route=read('src/app/api/admin/platform/onboarding-analytics/route.ts');
    const repo=read('src/platform/onboarding/analyticsRepository.ts');
    expect(route).toContain('await requirePlatformOperator()');
    expect(route).toContain("'Cache-Control':'no-store'");
    expect(repo).toContain("IndustryCode=N'salon' AND StartMode=N'real'");
    expect(repo).toContain('l.TenantId=c.TenantId');
    expect(repo).toContain('COUNT_BIG(*)');
    expect(repo).not.toMatch(/PhoneNormalized|ContactName|IpHash|Email|INSERT INTO|UPDATE dbo|DELETE FROM/i);
  });
});
