import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const resolveEmployeeGlobalSchedule = vi.fn();
const canBranchAppearInPublicBooking = vi.fn();
const getPublicBookingServicesCatalog = vi.fn();
const resolvePublicBookingBranchContext = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: async () => ({
    request: () => ({
      input() {
        return this;
      },
      query: async () => ({
        recordset: [
          {
            EmpID: 12,
            EmpName: 'زياد',
            Job: 'حلاق',
            BranchID: 1,
            BranchCode: 'GLEEM',
            BranchName: 'جليم',
            CanReceiveBookings: 1,
            IsActiveAssign: 1,
          },
          {
            EmpID: 999,
            EmpName: '[TEST] Ghost',
            Job: 'حلاق',
            BranchID: 1,
            BranchCode: 'GLEEM',
            BranchName: 'جليم',
            CanReceiveBookings: 1,
            IsActiveAssign: 1,
          },
        ],
      }),
    }),
  }),
  sql: { Int: 0, Date: 0, NVarChar: () => 0, Bit: 0 },
}));

vi.mock('@/lib/booking/publicBookingBranchContext', () => ({
  resolvePublicBookingBranchContext: (...a: unknown[]) => resolvePublicBookingBranchContext(...a),
  PublicBookingBranchContextError: class extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

vi.mock('@/lib/booking/publicBookingServices', () => ({
  getPublicBookingServicesCatalog: (...a: unknown[]) => getPublicBookingServicesCatalog(...a),
  invalidatePublicBookingServicesCache: () => undefined,
}));

vi.mock('@/lib/hr/employeeBranchScheduleResolver', () => ({
  resolveEmployeeGlobalSchedule: (...a: unknown[]) => resolveEmployeeGlobalSchedule(...a),
}));

vi.mock('@/lib/branch/publicBranchVisibility', () => ({
  canBranchAppearInPublicBooking: (...a: unknown[]) => canBranchAppearInPublicBooking(...a),
}));

vi.mock('@/lib/branch/repository', () => ({
  getBranchById: async () => ({
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'جليم',
    address: 'addr',
    phone: '01',
  }),
}));

vi.mock('@/lib/publicBookingHelpers', () => ({
  getPublicSettings: async () => ({ maxBookingDaysAhead: 14 }),
  isValidDate: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s),
}));

vi.mock('@/lib/businessDate', () => ({
  getCairoBusinessDate: () => '2026-08-01',
}));

describe('bookingPublicBarberCalendar / Location / BranchMode', () => {
  beforeEach(() => {
    vi.resetModules();
    resolveEmployeeGlobalSchedule.mockReset();
    canBranchAppearInPublicBooking.mockReset();
    getPublicBookingServicesCatalog.mockReset();
    resolvePublicBookingBranchContext.mockReset();
    canBranchAppearInPublicBooking.mockResolvedValue(true);
    getPublicBookingServicesCatalog.mockResolvedValue({
      services: [{ serviceId: 9 }, { serviceId: 10 }],
    });
    resolvePublicBookingBranchContext.mockResolvedValue({
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      publicBookingEnabled: true,
      bookingEnabled: true,
    });
  });

  it('branch mode rejects CAMP_CAESAR via context error', async () => {
    const { PublicBookingBranchContextError } = await import(
      '@/lib/booking/publicBookingBranchContext'
    );
    resolvePublicBookingBranchContext.mockImplementation(async (args: { branchCode?: string }) => {
      if (String(args.branchCode).toUpperCase() === 'CAMP_CAESAR') {
        throw new PublicBookingBranchContextError('BRANCH_NOT_PUBLIC');
      }
      return {
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        publicBookingEnabled: true,
        bookingEnabled: true,
      };
    });
    const mod = await import('@/lib/booking/publicBookingBarbers');
    mod.invalidatePublicBookingBarbersCache();
    await expect(
      mod.listPublicBookingBarbers({ mode: 'branch', branchCode: 'CAMP_CAESAR' }),
    ).rejects.toMatchObject({ code: 'BRANCH_NOT_PUBLIC' });
  });

  it('branch mode requires branchCode', async () => {
    const mod = await import('@/lib/booking/publicBookingBarbers');
    await expect(mod.listPublicBookingBarbers({ mode: 'branch' })).rejects.toMatchObject({
      code: 'BRANCH_REQUIRED',
    });
  });

  it('calendar validates range and returns presence_only / day_off', async () => {
    resolveEmployeeGlobalSchedule.mockImplementation(async (args: { workDate: string }) => {
      if (args.workDate === '2026-08-01') {
        return {
          isGlobalDayOff: false,
          isGloballyWorking: true,
          branches: [
            {
              branchId: 1,
              branchCode: 'GLEEM',
              branchName: 'جليم',
              isWorking: true,
              startTime: '11:00',
              endTime: '01:30',
              startDayOffset: 0,
              endDayOffset: 1,
            },
          ],
        };
      }
      return { isGlobalDayOff: false, isGloballyWorking: false, branches: [] };
    });

    // loadPublicEmployeeOrThrow needs emp query — override getPool for emp lookup
    const mod = await import('@/lib/booking/publicBookingBarbers');
    mod.invalidatePublicBookingBarbersCache();

    // Emp load uses same mock query returning test rows — EmpID 12 present
    // But loadPublicEmployeeOrThrow queries TblEmp only — our mock returns assignment-shaped rows.
    // Patch: the mock returns EmpID/EmpName which works for SELECT EmpID, EmpName...
    const cal = await mod.getPublicBarberCalendar({
      empId: 12,
      from: '2026-08-01',
      to: '2026-08-02',
    });
    expect(cal.presenceOnly).toBe(true);
    expect(cal.days[0]?.status).toBe('presence_only');
    expect(cal.days[0]?.branches[0]?.endDayOffset).toBe(1);
    expect(cal.days[1]?.status).toBe('day_off');

    await expect(
      mod.getPublicBarberCalendar({ empId: 12, from: '2026-08-01', to: '2026-09-15' }),
    ).rejects.toMatchObject({ code: 'DATE_RANGE_TOO_LARGE' });
  });

  it('location working vs off; non-public work → not_available_publicly', async () => {
    const mod = await import('@/lib/booking/publicBookingBarbers');
    mod.invalidatePublicBookingBarbersCache();

    resolveEmployeeGlobalSchedule.mockImplementation(async (args: { publicOnly?: boolean }) => {
      if (args.publicOnly) {
        return { isGlobalDayOff: false, isGloballyWorking: false, branches: [] };
      }
      return {
        isGlobalDayOff: false,
        isGloballyWorking: true,
        branches: [
          {
            branchId: 3,
            branchCode: 'CAMP_CAESAR',
            branchName: 'كامب',
            isWorking: true,
            startTime: '11:00',
            endTime: '20:00',
            startDayOffset: 0,
            endDayOffset: 0,
          },
        ],
      };
    });

    const loc = await mod.getPublicBarberLocation({ empId: 12, date: '2026-08-05' });
    expect(loc.isWorking).toBe(false);
    expect(loc.status).toBe('not_available_publicly');
    expect(loc.branch).toBeNull();
    expect(JSON.stringify(loc)).not.toContain('CAMP_CAESAR');
  });

  it('rejects invalid requested serviceIds', async () => {
    const mod = await import('@/lib/booking/publicBookingBarbers');
    await expect(
      mod.listPublicBookingBarbers({
        mode: 'global',
        serviceIds: [999999],
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_AVAILABLE_AT_BRANCH' });
  });

  it('cache isolates and invalidates', async () => {
    resolveEmployeeGlobalSchedule.mockResolvedValue({
      isGlobalDayOff: false,
      isGloballyWorking: true,
      branches: [
        {
          branchId: 1,
          branchCode: 'GLEEM',
          branchName: 'جليم',
          isWorking: true,
          startTime: '11:00',
          endTime: '20:00',
          startDayOffset: 0,
          endDayOffset: 0,
        },
      ],
    });
    const mod = await import('@/lib/booking/publicBookingBarbers');
    mod.invalidatePublicBookingBarbersCache();
    const a = await mod.listPublicBookingBarbers({ mode: 'branch', branchCode: 'GLEEM' });
    const b = await mod.listPublicBookingBarbers({ mode: 'branch', branchCode: 'GLEEM' });
    expect(a.meta.count).toBe(b.meta.count);
    expect(a.barbers.every((x) => !String(x.name).includes('[TEST]'))).toBe(true);
    mod.invalidatePublicBookingBarbersCache();
  });
});
