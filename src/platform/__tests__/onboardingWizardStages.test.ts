/**
 * Customer onboarding wizard — post-core setup stages. Two new tenants (A, B) plus a CUT-like
 * existing tenant run through the real stage executors against the in-memory SQL engine; branch,
 * user and HR domain services are spies so every call's tenant can be asserted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeMasterDataDb } from './helpers/fakeMasterDataSql';
import type { OnboardingSetupContext } from '@/platform/onboarding/wizard/setupStages';
import type { OnboardingRequest } from '@/platform/onboarding/wizard/types';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const h = vi.hoisted(() => ({
  db: null as unknown,
  /** legacy BranchID -> owning tenant */
  branchTenant: new Map<number, string>(),
  nextBranchId: 100,
  calls: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock('@/lib/db', async () => {
  const mod = await import('./helpers/fakeMasterDataSql');
  const db = mod.createFakeMasterDataDb();
  h.db = db;
  return mod.fakeDbModule(db);
});

vi.mock('@/platform/tenant/tenantContext', () => ({
  listTenantLegacyBranchIds: async (tenantId: string) =>
    new Set([...h.branchTenant].filter(([, t]) => t === tenantId).map(([id]) => id)),
  assertLegacyBranchInTenant: async (tenantId: string, branchId: number) => {
    if (h.branchTenant.get(branchId) !== tenantId) throw new Error('BRANCH_NOT_IN_TENANT');
  },
}));
vi.mock('@/lib/branch/repository', () => ({
  getBranchByCode: async (code: string) => {
    const row = (h.db as FakeMasterDataDb).rows('TblBranch').find((r) => r.BranchCode === code);
    return row ? { branchId: Number(row.BranchID), branchCode: code } : null;
  },
}));
vi.mock('@/lib/branch/branchProvisioningService', () => ({
  provisionBranch: async (input: Record<string, unknown>, actor: { tenantId: string; userId: number }) => {
    h.calls.push({ fn: 'provisionBranch', args: { input, actor } });
    const branchId = h.nextBranchId++;
    h.branchTenant.set(branchId, actor.tenantId);
    (h.db as FakeMasterDataDb).tables.TblBranch.push({ BranchID: branchId, BranchCode: input.branchCode });
    return { branch: { branchId } };
  },
}));
vi.mock('@/lib/branch/bootstrap', () => ({
  ensureQueueBookingSettingsForBranch: async (branchId: number, opts: unknown) => {
    h.calls.push({ fn: 'ensureQueueBookingSettingsForBranch', args: { branchId, opts } });
  },
  grantUserBranchAccess: async (args: unknown) => {
    h.calls.push({ fn: 'grantUserBranchAccess', args });
  },
}));
vi.mock('@/lib/branch/userLoginBranch', () => ({
  grantStaffAccessToAllActiveBranches: async (args: { tenantId: string; preferredBranchId: number }) => {
    h.calls.push({ fn: 'grantStaffAccessToAllActiveBranches', args });
    return { grantedBranchIds: [] as number[] };
  },
}));
vi.mock('@/lib/branch/assignmentIntegrity', () => ({
  ensureEmployeeBranchAssignment: async (args: unknown) => {
    h.calls.push({ fn: 'ensureEmployeeBranchAssignment', args });
  },
}));
vi.mock('@/lib/hr/tenantEmployeeCreate', () => ({
  createTenantEmployee: async (args: { tenantId: string; name: string; job: string; isActive: boolean }) => {
    h.calls.push({ fn: 'createTenantEmployee', args });
    const rows = (h.db as FakeMasterDataDb).tables.TblEmp;
    const empId = rows.length + 1;
    rows.push({ EmpID: empId, TenantId: args.tenantId, EmpName: args.name, Job: args.job });
    return { empId };
  },
}));
vi.mock('@/lib/tenant/tenantStaffUsers', () => ({
  createTenantStaffUser: async (args: { tenantId: string; loginName: string; userName: string }) => {
    h.calls.push({ fn: 'createTenantStaffUser', args });
    const db = h.db as FakeMasterDataDb;
    const userId = 500 + db.tables.TblUser.length;
    db.tables.TblUser.push({ UserID: userId, loginName: args.loginName, isDeleted: 0 });
    db.tables.TenantMembership.push({ MembershipId: userId, TenantId: args.tenantId, LegacyUserId: userId });
    return { ok: true, user: { UserID: userId } };
  },
}));
vi.mock('@/lib/booking/publicBookingServices', () => ({ invalidatePublicBookingServicesCache: () => {} }));
vi.mock('@/lib/booking/publicBookingBarbers', () => ({ invalidatePublicBookingBarbersCache: () => {} }));
vi.mock('@/lib/publicBookingHelpers', () => ({ invalidatePublicSettingsCache: () => {} }));

const fake = () => h.db as FakeMasterDataDb;

function baseRequest(overrides: Partial<OnboardingRequest> = {}): OnboardingRequest {
  return {
    business: {
      businessName: 'Salon One',
      tenantCode: 'SALON_ONE',
      industryPackCode: 'salon',
      timezone: 'Africa/Cairo',
      currency: 'EGP',
    },
    branches: [{ branchName: 'Main', branchCode: 'SALON_ONE_1' }],
    services: [],
    employees: [],
    owner: { displayName: 'Owner', loginName: 'owner.one', password: 'Secret123' },
    users: [],
    apps: { add: [], remove: [] },
    subscription: { planCode: 'starter', status: 'trial' },
    booking: [],
    ai: null,
    ...overrides,
  };
}

function ctxFor(tenantId: string, firstBranchId: number, apps = ['booking', 'queue', 'pos']): OnboardingSetupContext {
  return {
    tenantId,
    tenantCode: tenantId === A ? 'SALON_ONE' : 'SALON_TWO',
    packCode: 'salon',
    apps,
    ownerUserId: tenantId === A ? 11 : 22,
    actorUserId: 1,
    branchIds: new Map([[tenantId === A ? 'SALON_ONE_1' : 'SALON_TWO_1', firstBranchId]]),
  };
}

async function stages() {
  return import('@/platform/onboarding/wizard/setupStages');
}

beforeEach(async () => {
  await stages();
  fake().reset();
  Object.assign(fake().tables, {
    TblBranch: [
      { BranchID: 1, BranchCode: 'CUT_MAIN' },
      { BranchID: 10, BranchCode: 'SALON_ONE_1' },
      { BranchID: 20, BranchCode: 'SALON_TWO_1' },
    ],
    TblUser: [{ UserID: 7, loginName: 'cut.admin', isDeleted: 0 }],
    TenantMembership: [{ MembershipId: 7, TenantId: CUT, LegacyUserId: 7 }],
    TblRoles: [
      { RoleID: 2, RoleKey: 'admin', IsActive: 1 },
      { RoleID: 3, RoleKey: 'manager', IsActive: 1 },
      { RoleID: 4, RoleKey: 'cashier', IsActive: 1 },
      { RoleID: 6, RoleKey: 'receptionist', IsActive: 1 },
    ],
    TblUserRoles: [],
    TenantAiConfig: [],
    QueueBookingSettings: [
      { BranchID: 1, SalonName: 'Cut Salon', SlotIntervalMinutes: 10, BookingEnabled: 1 },
      { BranchID: 10, SalonName: 'x', SlotIntervalMinutes: 30, BookingEnabled: 0 },
      { BranchID: 20, SalonName: 'y', SlotIntervalMinutes: 30, BookingEnabled: 0 },
    ],
  });
  fake().tables.TblCat.push({ CatID: 1, TenantId: CUT, CatName: 'خدمات' });
  fake().tables.TblPro.push({ ProID: 1, TenantId: CUT, ProName: 'Haircut', SPrice1: 80, CatID: 1 });
  h.branchTenant = new Map([
    [1, CUT],
    [10, A],
    [20, B],
  ]);
  h.nextBranchId = 100;
  h.calls = [];
});

describe('services stage', () => {
  it('creates services only for the target tenant, in its own category, and retries without duplicates', async () => {
    const { runServicesStage } = await stages();
    const services = [
      { name: 'Haircut', price: 150, durationMinutes: 30, active: true },
      { name: 'Beard', price: 60, durationMinutes: 15, active: false, categoryName: 'لحية' },
    ];
    const first = await runServicesStage(ctxFor(A, 10), baseRequest({ services }));
    expect(first).toEqual({ created: 2, existing: 0 });
    await runServicesStage(ctxFor(B, 20), baseRequest({ services: [services[0]!] }));

    const pro = fake().rows('TblPro');
    const aRows = pro.filter((r) => r.TenantId === A);
    expect(aRows.map((r) => r.ProName).sort()).toEqual(['Beard', 'Haircut']);
    expect(aRows.find((r) => r.ProName === 'Haircut')!.SPrice1).toBe(150);
    expect(aRows.find((r) => r.ProName === 'Beard')!.isDeleted).toBe(1);
    const aCats = new Set(fake().rows('TblCat').filter((r) => r.TenantId === A).map((r) => r.CatID));
    expect(aRows.every((r) => aCats.has(r.CatID))).toBe(true);
    expect(pro.filter((r) => r.TenantId === B)).toHaveLength(1);

    const retry = await runServicesStage(ctxFor(A, 10), baseRequest({ services }));
    expect(retry).toEqual({ created: 0, existing: 2 });
    expect(fake().rows('TblPro').filter((r) => r.TenantId === A)).toHaveLength(2);
  });

  it('never copies or modifies CUT master data for a new salon', async () => {
    const { runServicesStage } = await stages();
    await runServicesStage(ctxFor(A, 10), baseRequest({ services: [{ name: 'Wash', price: 40, durationMinutes: 15, active: true }] }));
    const cut = fake().rows('TblPro').filter((r) => r.TenantId === CUT);
    expect(cut).toEqual([{ ProID: 1, TenantId: CUT, ProName: 'Haircut', SPrice1: 80, CatID: 1 }]);
    expect(fake().rows('TblPro').filter((r) => r.TenantId === A).map((r) => r.ProName)).toEqual(['Wash']);
    expect(fake().statements.some((s) => /INSERT INTO TblPro .* SELECT/i.test(s))).toBe(false);
  });
});

describe('team stage', () => {
  it('creates employees with the new tenant id and assigns them only to its branches', async () => {
    const { runTeamStage } = await stages();
    const employees = [
      { name: 'Hassan', job: 'حلاق', primaryBranchCode: 'SALON_ONE_1', active: true },
      { name: 'Mona', job: 'موظف استقبال', primaryBranchCode: 'SALON_ONE_1', active: true },
    ];
    expect(await runTeamStage(ctxFor(A, 10), baseRequest({ employees }))).toEqual({ created: 2, existing: 0 });
    const created = h.calls.filter((c) => c.fn === 'createTenantEmployee').map((c) => c.args as { tenantId: string });
    expect(created.every((a) => a.tenantId === A)).toBe(true);
    const assigned = h.calls
      .filter((c) => c.fn === 'ensureEmployeeBranchAssignment')
      .map((c) => c.args as { branchId: number; canReceiveBookings: boolean });
    expect(assigned.map((a) => a.branchId)).toEqual([10, 10]);
    expect(assigned.map((a) => a.canReceiveBookings)).toEqual([true, false]);

    expect(await runTeamStage(ctxFor(A, 10), baseRequest({ employees }))).toEqual({ created: 0, existing: 2 });
    expect(fake().rows('TblEmp').filter((r) => r.TenantId === A)).toHaveLength(2);
  });

  it('rejects a branch that is not a branch of the business', async () => {
    const { runTeamStage } = await stages();
    const employees = [{ name: 'X', job: 'حلاق', primaryBranchCode: 'CUT_MAIN', active: true }];
    await expect(runTeamStage(ctxFor(A, 10), baseRequest({ employees }))).rejects.toMatchObject({
      code: 'ONBOARDING_TARGET_INVALID',
    });
    expect(fake().rows('TblEmp')).toHaveLength(0);
  });
});

describe('users stage', () => {
  const users = [
    { displayName: 'Desk', loginName: 'desk.one', password: 'Desk12345', roleKey: 'receptionist', defaultBranchCode: 'SALON_ONE_1' },
  ];

  it('creates users only in the target tenant with an existing role and tenant branch access', async () => {
    const { runUsersStage } = await stages();
    expect(await runUsersStage(ctxFor(A, 10), baseRequest({ users }))).toEqual({ created: 1, existing: 0 });
    const created = h.calls.find((c) => c.fn === 'createTenantStaffUser')!.args as { tenantId: string; userLevel: string };
    expect(created).toMatchObject({ tenantId: A, userLevel: 'user' });
    const grant = h.calls.find((c) => c.fn === 'grantStaffAccessToAllActiveBranches')!.args as { tenantId: string; preferredBranchId: number };
    expect(grant).toMatchObject({ tenantId: A, preferredBranchId: 10 });
    expect(fake().rows('TblUserRoles')).toEqual([{ UserID: expect.any(Number), RoleID: 6 }]);

    expect(await runUsersStage(ctxFor(A, 10), baseRequest({ users }))).toEqual({ created: 0, existing: 1 });
    expect(fake().rows('TblUserRoles')).toHaveLength(1);
  });

  it('refuses a login that belongs to another tenant instead of joining it', async () => {
    const { runUsersStage } = await stages();
    const taken = [{ ...users[0]!, loginName: 'cut.admin' }];
    await expect(runUsersStage(ctxFor(A, 10), baseRequest({ users: taken }))).rejects.toMatchObject({
      code: 'OWNER_USERNAME_CONFLICT',
    });
    expect(fake().rows('TenantMembership').filter((r) => r.LegacyUserId === 7)).toEqual([
      { MembershipId: 7, TenantId: CUT, LegacyUserId: 7 },
    ]);
  });
});

describe('booking stage', () => {
  const booking = [
    {
      branchCode: 'SALON_ONE_1',
      defaultMode: 'nearest',
      slotIntervalMinutes: 15,
      minNoticeMinutes: 30,
      maxBookingDaysAhead: 14,
      defaultServiceDurationMinutes: 30,
      allowSpecificBarber: true,
      allowNearestBarber: true,
    },
  ];

  it('updates booking settings only for the tenant branches and never enables booking', async () => {
    const { runBookingStage } = await stages();
    await runBookingStage(ctxFor(A, 10), baseRequest({ booking }));
    const rows = fake().rows('QueueBookingSettings');
    expect(rows.find((r) => r.BranchID === 10)).toMatchObject({ SlotIntervalMinutes: 15, BookingEnabled: 0, Currency: 'EGP' });
    expect(rows.find((r) => r.BranchID === 1)).toEqual({ BranchID: 1, SalonName: 'Cut Salon', SlotIntervalMinutes: 10, BookingEnabled: 1 });
    expect(rows.find((r) => r.BranchID === 20)!.SlotIntervalMinutes).toBe(30);
    const seeded = h.calls.find((c) => c.fn === 'ensureQueueBookingSettingsForBranch')!.args as { opts: { bookingEnabled: boolean } };
    expect(seeded.opts.bookingEnabled).toBe(false);
    expect(fake().statements.some((s) => /BookingEnabled\s*=/.test(s) || /PublicBooking/i.test(s))).toBe(false);
  });

  it('rejects a branch id that does not belong to the tenant', async () => {
    const { runBookingStage } = await stages();
    const ctx = ctxFor(A, 10);
    ctx.branchIds.set('SALON_TWO_1', 20);
    await expect(
      runBookingStage(ctx, baseRequest({ booking: [{ ...booking[0]!, branchCode: 'SALON_TWO_1' }] })),
    ).rejects.toThrow('BRANCH_NOT_IN_TENANT');
    expect(fake().rows('QueueBookingSettings').find((r) => r.BranchID === 20)!.SlotIntervalMinutes).toBe(30);
  });
});

describe('branches stage', () => {
  it('provisions extra branches inside the new tenant without operator access', async () => {
    const { runBranchesStage } = await stages();
    const branches = [
      { branchName: 'Main', branchCode: 'SALON_ONE_1' },
      { branchName: 'Second', branchCode: 'SALON_ONE_2' },
    ];
    const ctx = ctxFor(A, 10);
    expect(await runBranchesStage(ctx, baseRequest({ branches }))).toEqual({ created: 1, existing: 0 });
    const call = h.calls.find((c) => c.fn === 'provisionBranch')!.args as {
      input: { grantActorAccess: boolean; queueSettings: { salonName: string } };
      actor: { tenantId: string };
    };
    expect(call.actor.tenantId).toBe(A);
    expect(call.input.grantActorAccess).toBe(false);
    expect(call.input.queueSettings.salonName).toBe('Second');
    expect(ctx.branchIds.get('SALON_ONE_2')).toBe(100);
    const ownerGrant = h.calls.find((c) => c.fn === 'grantUserBranchAccess')!.args as { userId: number; branchId: number };
    expect(ownerGrant).toMatchObject({ userId: 11, branchId: 100 });

    expect(await runBranchesStage(ctxFor(A, 10), baseRequest({ branches }))).toEqual({ created: 0, existing: 1 });
    expect(h.calls.filter((c) => c.fn === 'provisionBranch')).toHaveLength(1);
  });

  it('never adopts a branch code owned by another tenant', async () => {
    const { runBranchesStage } = await stages();
    const branches = [
      { branchName: 'Main', branchCode: 'SALON_ONE_1' },
      { branchName: 'Stolen', branchCode: 'CUT_MAIN' },
    ];
    await expect(runBranchesStage(ctxFor(A, 10), baseRequest({ branches }))).rejects.toMatchObject({
      code: 'BRANCH_CODE_CONFLICT',
    });
    expect(h.calls.filter((c) => c.fn === 'provisionBranch')).toHaveLength(0);
  });
});

describe('AI stage', () => {
  it('saves a disabled AI profile for the tenant only, once', async () => {
    const { runAiStage } = await stages();
    const ai = {
      businessName: 'Salon One',
      locale: 'ar-EG',
      policies: ['No refunds', ' '],
      useSalonConciergePack: true,
    };
    const out = await runAiStage(ctxFor(A, 10, ['booking', 'messaging', 'ai-receptionist']), baseRequest({ ai }));
    expect(out.created).toBe(1);
    expect(fake().rows('TenantAiConfig')).toEqual([
      expect.objectContaining({
        TenantId: A,
        Enabled: 0,
        ConversationPack: 'salon-concierge-v1',
        PoliciesJson: JSON.stringify(['No refunds']),
      }),
    ]);
    expect((await runAiStage(ctxFor(A, 10), baseRequest({ ai }))).existing).toBe(1);
    expect(fake().rows('TenantAiConfig')).toHaveLength(1);
  });
});
