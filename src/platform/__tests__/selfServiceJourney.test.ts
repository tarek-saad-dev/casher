import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GoLiveMilestone, GoLiveMilestoneId, TenantGoLiveReport } from '@/platform/onboarding/goLiveTypes';
import { buildSelfServiceJourney, isSelfServiceStepId } from '@/platform/onboarding/selfServiceJourney';

import { parseSetupAction, SetupInputError, SETUP_JOBS } from '@/platform/onboarding/selfServiceInput';

const IDS: GoLiveMilestoneId[] = [
  'commercial_access', 'active_branch', 'catalog', 'team', 'users',
  'business_day', 'first_shift', 'first_sale', 'first_booking',
];

function example(done: GoLiveMilestoneId[] = [], bookingInstalled = true): TenantGoLiveReport {
  const milestones: GoLiveMilestone[] = IDS.map((id) => ({
    id, label: id, detail: id, action: id,
    status: id === 'first_booking' && !bookingInstalled ? 'not_applicable' : done.includes(id) ? 'done' : 'pending',
    count: done.includes(id) ? 1 : 0,
  }));
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantCode: 'NEW_SALON',
    tenantName: 'صالون جديد',
    ownerLoginName: 'u201012345678',
    bookingInstalled,
    status: 'IN_PROGRESS',
    completed: done.length,
    total: bookingInstalled ? 9 : 8,
    progressPercent: 0,
    primaryBranch: { branchId: 42, branchCode: 'NEW_MAIN', branchName: 'الفرع الرئيسي' },
    milestones,
  };
}

describe('self-service salon onboarding', () => {
  it('renders stable routed steps and does not depend on local storage flags', () => {
    const journey = buildSelfServiceJourney(example());
    expect(journey.steps.map((s) => s.href)).toEqual([
      '/setup', '/setup/branch', '/setup/services',
      '/setup/team', '/setup/launch', '/setup/finish',
    ]);
    expect(journey.progressPercent).toBe(0);
    expect(journey.ready).toBe(false);
    expect(journey.steps[0].complete).toBe(true);
    expect(isSelfServiceStepId('branch')).toBe(true);
    expect(isSelfServiceStepId('not-real')).toBe(false);
  });

  it('tracks only the tenant-scoped branch, catalog, team and day + shift setup', () => {
    const journey = buildSelfServiceJourney(example([
      'commercial_access', 'active_branch', 'users', 'catalog', 'team',
    ]));
    expect(journey.completeCount).toBe(3);
    expect(journey.totalCount).toBe(4);
    expect(journey.progressPercent).toBe(75);
    expect(journey.steps.find((s) => s.id === 'launch')?.complete).toBe(false);
    expect(journey.pendingMilestones).toEqual(['business_day', 'first_shift']);
  });

  it('does not require a real sale or public booking to complete initial setup', () => {
    const journey = buildSelfServiceJourney(example([
      'commercial_access', 'active_branch', 'catalog', 'team', 'users',
      'business_day', 'first_shift',
    ]));
    expect(journey.ready).toBe(true);
    expect(journey.progressPercent).toBe(100);
    expect(journey.steps.find((s) => s.id === 'finish')?.complete).toBe(true);
    expect(journey.bookingInstalled).toBe(true);
  });

  it('reports real tenant first-sale evidence without changing setup completion', () => {
    const completed: GoLiveMilestoneId[] = ['commercial_access', 'active_branch', 'catalog', 'team', 'users', 'business_day', 'first_shift'];
    const pending = buildSelfServiceJourney(example(completed));
    const sold = buildSelfServiceJourney(example([...completed, 'first_sale']));
    expect(pending.firstSaleStatus).toBe('pending');
    expect(pending.firstSaleCount).toBe(0);
    expect(sold.firstSaleStatus).toBe('done');
    expect(sold.firstSaleCount).toBe(1);
    expect(pending.ready).toBe(true);
    expect(sold.ready).toBe(true);
    expect(sold.progressPercent).toBe(pending.progressPercent);
    const report=example(completed);
    report.milestones=report.milestones.filter(item=>item.id!=='first_sale');
    expect(buildSelfServiceJourney(report).firstSaleStatus).toBeNull();
  });

  it('does not call an uninstalled booking app a required setup step', () => {
    const journey = buildSelfServiceJourney(example([
      'commercial_access', 'active_branch', 'catalog', 'team', 'users',
      'business_day', 'first_shift',
    ], false));
    expect(journey.ready).toBe(true);
    expect(journey.bookingInstalled).toBe(false);
  });

  it('requires commercial access and owner membership even if operating milestones exist', () => {
    const journey = buildSelfServiceJourney(example([
      'active_branch', 'catalog', 'team', 'business_day', 'first_shift',
    ]));
    expect(journey.progressPercent).toBe(100);
    expect(journey.ready).toBe(false);
  });
});

describe('self-service setup security and routing guardrails', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('keeps onboarding read-only, admin-scoped and bound to session tenant only', () => {
    const route = read('src/app/api/tenant/onboarding/route.ts');
    expect(route).toContain('requireAdmin()');
    expect(route).toContain('evaluateTenantGoLive(auth.tenantId)');
    expect(route).toContain('report.tenantId.toLowerCase() !== auth.tenantId.toLowerCase()');
    expect(route).not.toMatch(/\b(req\.query|searchParams|INSERT INTO|UPDATE dbo\.)\b/i);
    expect(route).toContain("'Cache-Control': 'no-store'");
  });

  it('requires admin auth for every routed setup page', () => {
    const layout = read('src/app/setup/layout.tsx');
    expect(layout).toContain('requireAdmin()');
    expect(layout).toContain("redirect('/login')");
  });

  it('routes new salons into the guide without changing supermarket entry', () => {
    const service = read('src/platform/publicSignup/service.ts');
    expect(service).toContain("nextPath: input.industry === 'salon' ? '/setup' : '/operations'");
    expect(service).toContain('onboardBusiness(');
  });

  it('does not mutate the public booking flag, channels or trial terms', () => {
    const files = [
      'src/app/api/tenant/onboarding/route.ts',
      'src/platform/onboarding/selfServiceJourney.ts',
      'src/components/onboarding/SelfServiceSetup.tsx',
    ].map(read).join('\n');
    expect(files).not.toMatch(/PublicBookingEnabled|UPDATE\s+dbo\.|TenantMessagingChannel/);
    expect(files).not.toContain('/api/public/signup/complete');
  });
});

describe('inline setup input and tenant boundaries', () => {
  it('normalizes valid branch, service and employee actions', () => {
    expect(parseSetupAction({ action: 'branch', address: ' شارع 1 ', phone: '01012345678', defaultOpenTime: '10:00', defaultCloseTime: '01:00' })).toMatchObject({ action: 'branch', address: 'شارع 1' });
    expect(parseSetupAction({ action: 'service', name: ' حلاقة ', price: 150.5, durationMinutes: 30 })).toEqual({
      action: 'service', service: { name: 'حلاقة', arabicName: 'حلاقة', price: 150.5, durationMinutes: 30, active: true },
    });
    expect(parseSetupAction({ action: 'employee', name: ' أحمد ', job: SETUP_JOBS[0] })).toEqual({ action: 'employee', employee: { name: 'أحمد', job: SETUP_JOBS[0], active: true } });
  });

  it('rejects client-selected tenant/branch IDs and invalid values', () => {
    const service = { action: 'service', name: 'قص', price: 150, durationMinutes: 30 };
    for (const payload of [
      { ...service, tenantId: 'another-tenant' },
      { ...service, price: -10 },
      { ...service, price: '150' },
      { ...service, price: 1.234 },
      { ...service, durationMinutes: 0 },
      { ...service, durationMinutes: 30.5 },
      { action: 'employee', name: 'أحمد', job: 'unknown' },
      { action: 'employee', name: 'أحمد', job: SETUP_JOBS[0], primaryBranchCode: 'FOREIGN' },
      { action: 'branch', address: 'عنوان', phone: '1234', defaultOpenTime: '09:00', defaultCloseTime: '21:00' },
      { action: 'branch', address: 'عنوان', phone: '01012345678', defaultOpenTime: '25:00', defaultCloseTime: '21:00' },
      { action: 'branch', address: 'عنوان', phone: '01012345678', defaultOpenTime: '09:00', defaultCloseTime: '09:00' },
      { action: 'branch', address: 'عنوان', phone: '01012345678', defaultOpenTime: '09:00', defaultCloseTime: '21:00', branchId: 999 },
    ]) expect(() => parseSetupAction(payload)).toThrow(SetupInputError);
  });

  it('does not consider an empty branch address complete just because a branch exists', () => {
    const journey = buildSelfServiceJourney(example([
      'commercial_access', 'active_branch', 'catalog', 'team', 'users', 'business_day', 'first_shift',
    ]), { name: 'فرع أول', complete: false });
    expect(journey.branchName).toBe('فرع أول');
    expect(journey.steps.find(s => s.id === 'branch')?.complete).toBe(false);
    expect(journey.progressPercent).toBe(75);
    expect(journey.ready).toBe(false);
  });

  it('keeps writes behind admin auth, self-registration eligibility and verified active branch', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    const route = read('src/app/api/tenant/onboarding/setup-data/route.ts');
    const eligibility = read('src/platform/onboarding/selfServiceEligibility.ts');
    const layout = read('src/app/setup/layout.tsx');
    expect(route.match(/await requireAdmin\(\)/g)).toHaveLength(2);
    expect(route).toContain('isPublicSalonSetupTenant(auth.tenantId, auth.tenant.tenantCode)');
    expect(route).toContain('assertLegacyBranchInTenant(auth.tenantId, auth.activeBranchId)');
    expect(route).toContain('primaryBranchCode: auth.activeBranchCode');
    expect(route).toContain('runServicesStage(ctx');
    expect(route).toContain('runTeamStage(ctx');
    expect(eligibility).toContain("tenantCode === 'CASHER_BOOT'");
    expect(eligibility).toContain("IndustryCode = N'salon' AND Status = N'provisioned'");
    expect(layout).toContain('isPublicSalonSetupTenant(auth.tenantId, auth.tenant.tenantCode)');
  });
});

describe('inline setup atomic writes', () => {
  it('serializes concurrent saves per tenant and commits employee creation with branch assignment', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    const route = read('src/app/api/tenant/onboarding/setup-data/route.ts');
    const stages = read('src/platform/onboarding/wizard/setupStages.ts');
    const employee = read('src/lib/hr/tenantEmployeeCreate.ts');
    const assignment = read('src/lib/branch/assignmentIntegrity.ts');
    expect(route).toContain("acquireTenantApplock(tx, auth.tenantId, ['onboarding', 'setup-data']");
    expect(route).toContain('runServicesStage(ctx, { services: [action.service] }, tx)');
    expect(route).toContain('primaryBranchCode: auth.activeBranchCode }] }, tx)');
    expect(route).toContain('await tx.commit()');
    expect(route).toContain('await tx.rollback()');
    expect(stages).toContain('createTenantEmployee({ tenantId, name, job: e.job, isActive: e.active, hr }, tx)');
    expect(stages).toContain('isHomeBranch: true,\n    }, tx)');
    expect(employee).toContain('if (!externalTransaction) await tx.commit()');
    expect(assignment).toContain('const db = externalTransaction ?? await getPool()');
  });
});

describe('active branch staffing readiness', () => {
  it('does not count employees of another branch as ready for the current branch', () => {
    const report = example(['commercial_access', 'active_branch', 'catalog', 'team', 'users', 'business_day', 'first_shift']);
    const incomplete = buildSelfServiceJourney(report, { name: 'الفرع الحالي', complete: true, assignedTeamCount: 0 });
    expect(incomplete.steps.find(s => s.id === 'team')?.complete).toBe(false);
    expect(incomplete.steps.find(s => s.id === 'team')?.count).toBe(0);
    expect(incomplete.ready).toBe(false);
    const ready = buildSelfServiceJourney(report, { name: 'الفرع الحالي', complete: true, assignedTeamCount: 2 });
    expect(ready.ready).toBe(true);
  });
});

import { identityDraft, identityPayload } from '@/platform/branding/onboardingIdentity';
import type { TenantBrandProfile } from '@/platform/branding/brandProfile';
describe('onboarding identity', () => {
  const p: TenantBrandProfile={tenantId:'tenant-a',displayName:'Salon',logoUrl:'/existing.png',phone:'01000000000',address:'address',primaryColor:null,accentColor:null,receiptFooter:null,timezone:'Africa/Cairo',publicBookingOrigins:['https://booking.example.com'],revision:0,updatedAt:null};
  it('preserves unrelated fields and revision including revision zero',()=>{
    const payload=identityPayload(p,{...identityDraft(p),displayName:' New Salon ',primaryColor:'#087e7a'});
    expect(payload).toMatchObject({displayName:'New Salon',primaryColor:'#087E7A',phone:p.phone,address:p.address,timezone:p.timezone,publicBookingOrigins:p.publicBookingOrigins,expectedRevision:0,logoUrl:p.logoUrl});
    expect(payload).not.toHaveProperty('tenantId');
  });
  it('does not accept arbitrary new local paths, unsafe URL schemes or invalid colors',()=>{
    for(const logoUrl of ['/api/private','//elsewhere.test/logo.png','javascript:alert(1)','http://example.com/a.png','https://u:p@example.com/a.png'])expect(()=>identityPayload(p,{...identityDraft(p),logoUrl})).toThrow();
    expect(identityPayload(p,{...identityDraft(p),logoUrl:'https://example.com/logo.png'}).logoUrl).toBe('https://example.com/logo.png');
    expect(()=>identityPayload(p,{...identityDraft(p),primaryColor:'red'})).toThrow();
  });
});

describe('smart team setup payroll and booking', () => {
  const employee = { action: 'employee', name: 'Ahmed', job: SETUP_JOBS[0] };
  it('passes initial HR and booking options through the existing employee create contract', () => {
    expect(parseSetupAction({...employee,employmentType:'full_time',payrollMethod:'monthly',payRate:6000,acceptsBookings:false})).toMatchObject({action:'employee',employee:{employmentType:'full_time',payrollMethod:'monthly',payRate:6000,acceptsBookings:false}});
    expect(parseSetupAction({...employee,employmentType:'freelance',payrollMethod:'daily',payRate:150.25})).toMatchObject({employee:{payRate:150.25}});
  });
  it('rejects incomplete, unsupported or malformed HR inputs', () => {
    for(const p of [{employmentType:'full_time'},{employmentType:'freelance',payrollMethod:'monthly',payRate:6000},{employmentType:'unknown',payrollMethod:'daily',payRate:100},{employmentType:'full_time',payrollMethod:'hourly',payRate:-1},{employmentType:'full_time',payrollMethod:'daily',payRate:1.234},{employmentType:'full_time',payrollMethod:'daily',payRate:'100'},{acceptsBookings:'yes'},{empId:5},{commissionPercent:50}])expect(()=>parseSetupAction({...employee,...p})).toThrow(SetupInputError);
  });
  it('requires installed apps and preserves existing employee payroll', () => {
    const route=fs.readFileSync(path.join(process.cwd(),'src/app/api/tenant/onboarding/setup-data/route.ts'),'utf8');
    expect(route).toContain("!ctx.apps.includes('payroll')");
    expect(route).toContain("!ctx.apps.includes('booking')");
    expect(route).toContain('if (Number(existing.HereNow)) return reply({ ok: true, created: 0, existing: 1 });');
    expect(route).toContain('runTeamStage(ctx');
  });
});

import { parseOperatingBookingPreferences } from '@/platform/onboarding/operatingPreferences';
describe('operating settings allowlist',()=>{
  const valid={slotIntervalMinutes:15,minNoticeMinutes:30,maxBookingDaysAhead:14};
  it('accepts only valid booking preferences',()=>{
    expect(parseOperatingBookingPreferences(valid)).toEqual(valid);
    for(const body of [{...valid,bookingEnabled:true},{...valid,publicBookingEnabled:true},{...valid,branchId:42},{...valid,tenantId:'foreign'},{...valid,slotIntervalMinutes:9},{...valid,minNoticeMinutes:'30'},{...valid,maxBookingDaysAhead:61},{slotIntervalMinutes:15}])expect(()=>parseOperatingBookingPreferences(body)).toThrow();
  });
  it('keeps the operating route gated and never changes payment or booking activation',()=>{
    const source=fs.readFileSync(path.join(process.cwd(),'src/app/api/tenant/onboarding/operating/route.ts'),'utf8');
    expect(source).toContain('requireAdmin()');
    expect(source).toContain('isPublicSalonSetupTenant');
    expect(source).toContain('assertLegacyBranchInTenant');
    expect(source).toContain("!c.apps.includes('booking')");
    expect(source).toContain('l.TenantId=@tenantId');
    expect(source).not.toMatch(/INSERT INTO|\b(?:SET|,)\s*(?:Public)?BookingEnabled\s*=(?!=)|TblCashMove|TblPaymentMethods/i);
  });
});

import { newTraining, nextTrainingStep, applyTrainingAction, trainingCash } from '@/platform/onboarding/trainingModel';
describe('isolated interactive training',()=>{
  it('uses installed apps and enforces the step sequence',()=>{
    expect(newTraining(['booking']).steps).toEqual(['customer','booking']);
    const initial=newTraining(['pos','booking','queue','treasury']);
    expect(initial.steps).toEqual(['customer','sale','booking','queue','treasury','close']);
    expect(()=>applyTrainingAction(initial,{step:'close'})).toThrow();
    const customer=applyTrainingAction(initial,{step:'customer'});
    expect(initial.completed).toEqual([]);
    expect(()=>applyTrainingAction(customer,{step:'customer'})).toThrow();
    expect(()=>applyTrainingAction(customer,{step:'sale',serviceId:'unknown',payment:'cash'})).toThrow();
    let state=applyTrainingAction(customer,{step:'sale',serviceId:'haircut',payment:'cash'});
    state=applyTrainingAction(state,{step:'booking'});
    state=applyTrainingAction(state,{step:'queue'});
    expect(trainingCash(state)).toBe(20000);
    expect(()=>applyTrainingAction(state,{step:'treasury',countedPiastres:10000})).toThrow();
    state=applyTrainingAction(state,{step:'treasury',countedPiastres:20000});
    state=applyTrainingAction(state,{step:'close'});
    expect(nextTrainingStep(state)).toBeNull();
    expect(state.closed).toBe(true);
    expect(newTraining(['pos']).sale).toBeNull();
  });
  it('keeps card sales out of cash and handles no-sale reconciliation',()=>{
    let state=applyTrainingAction(newTraining(['pos','treasury']),{step:'customer'});
    state=applyTrainingAction(state,{step:'sale',serviceId:'beard',payment:'card'});
    expect(state.sale?.piastres).toBe(10000);
    expect(trainingCash(state)).toBe(0);
    expect(applyTrainingAction(state,{step:'treasury',countedPiastres:0}).reconciled).toBe(true);
    const noSale=applyTrainingAction(newTraining(['treasury']),{step:'customer'});
    expect(applyTrainingAction(noSale,{step:'treasury',countedPiastres:0}).reconciled).toBe(true);
  });
  it('has no operational network or persistence dependencies',()=>{
    const sources=['src/components/onboarding/TrainingExperience.tsx','src/platform/onboarding/trainingModel.ts'].map(p=>fs.readFileSync(path.join(process.cwd(),p),'utf8')).join('\n');
    expect(sources).not.toMatch(/\bfetch\s*\(|\/api\/|localStorage|sessionStorage|indexedDB|XMLHttpRequest|useSession|@\/lib\/db|window\.print|sendBeacon/);
    const page=fs.readFileSync(path.join(process.cwd(),'src/app/setup/training/page.tsx'),'utf8');
    expect(page).toContain('requireAdmin()');
    expect(page).toContain('getTenantInstalledAppsForGate(auth.tenantId)');
  });
});

 describe('integrated V3 entry points', () => {
  it('keeps all setup and platform navigation in the guarded shells', () => {
    const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
    const setup=read('src/app/setup/layout.tsx');
    for(const href of ['/setup/identity','/setup/operating','/setup/training']) expect(setup).toContain(href);
    const platform=read('src/app/platform/layout.tsx');
    for(const href of ['/platform/authentication','/platform/onboarding-analytics']) expect(platform).toContain(href);
    const inline=read('src/components/onboarding/InlineSetupForm.tsx');
    expect(inline).toContain('<ServiceTemplatePicker');
    expect(inline).toContain('<SmartTeamSetup');
  });
});
