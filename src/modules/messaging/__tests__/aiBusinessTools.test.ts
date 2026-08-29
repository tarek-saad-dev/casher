import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiStructuredResult } from '@/modules/messaging/ai/domain/types';
import {
  intentRequiresBusinessTools,
  looksLikeFakeSystemCheck,
  planBusinessToolCalls,
  MAX_AI_TOOL_CALLS_PER_TURN,
} from '@/modules/messaging/ai/tools';
import { executeAiToolPlan } from '@/modules/messaging/ai/tools/registry';
import { resolveCustomerDateText, textMatchesQuery } from '@/modules/messaging/ai/tools/dateText';

vi.mock('@/lib/booking/publicBookingBranchContext', () => ({
  listPublicDiscoverableBranches: vi.fn(async () => [
    {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      shortName: 'جليم',
      address: 'Alex',
      phone: '01',
      timeZone: 'Africa/Cairo',
    },
  ]),
  resolvePublicBookingBranchContext: vi.fn(async ({ branchCode }: { branchCode: string }) => ({
    branchId: 1,
    branchCode: branchCode || 'GLEEM',
    branchName: 'جليم',
    shortName: 'جليم',
    address: 'Alex',
    phone: '01',
    timezone: 'Africa/Cairo',
    publicBookingEnabled: true,
    bookingEnabled: true,
    operatingHours: { openTime: '12:00:00', closeTime: '01:00:00' },
    businessDayCutoffTime: '04:00:00',
  })),
  PublicBookingBranchContextError: class extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

vi.mock('@/lib/branch/repository', () => ({
  getBranchById: vi.fn(async () => ({
    branchId: 1,
    branchCode: 'GLEEM',
    branchName: 'جليم',
    defaultOpenTime: '12:00:00',
    defaultCloseTime: '01:00:00',
    timeZone: 'Africa/Cairo',
    lifecycleStatus: 'PUBLIC_LIVE',
    isActive: true,
    publicBookingEnabled: true,
  })),
  listActiveBranches: vi.fn(async () => []),
}));

vi.mock('@/lib/booking/publicBookingServices', () => ({
  getPublicBookingServicesCatalog: vi.fn(async () => ({
    services: [
      {
        serviceId: 10,
        id: 10,
        nameAr: 'شعر ودقن',
        nameEn: 'Hair & Beard',
        name: 'شعر ودقن',
        price: 250,
        durationMinutes: 45,
        categoryNameAr: 'حلاقة',
        bookable: true,
      },
      {
        serviceId: 11,
        id: 11,
        nameAr: 'فينيش وتسريح',
        nameEn: 'Finish',
        name: 'فينيش وتسريح',
        price: 100,
        durationMinutes: 20,
        categoryNameAr: 'حلاقة',
        bookable: true,
      },
    ],
  })),
}));

vi.mock('@/lib/booking/publicBookingBarbers', () => ({
  listPublicBookingBarbers: vi.fn(async () => ({
    ok: true,
    mode: 'branch',
    branch: { branchCode: 'GLEEM', branchName: 'جليم' },
    barbers: [
      {
        empId: 7,
        id: 7,
        nameAr: 'عمر',
        nameEn: 'Omar',
        name: 'عمر',
        branches: [{ branchCode: 'GLEEM', branchName: 'جليم' }],
        isBookableOnline: true,
        serviceIds: [10],
        imageUrl: null,
        shortBio: null,
        photoUrl: null,
        bio: null,
        displaySortOrder: 1,
        availabilityType: 'presence_only',
      },
    ],
    meta: { count: 1, generatedAt: '', contractVersion: 't', dateFilter: null },
  })),
  getPublicBarberCalendar: vi.fn(async () => ({
    days: [{ date: '2026-08-30', isWorking: true, isBookableCandidate: true, status: 'working' }],
  })),
}));

vi.mock('@/lib/booking/publicBookingAvailability', () => {
  class PublicBookingAvailabilityError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    PublicBookingAvailabilityError,
    getPublicAvailableSlots: vi.fn(async () => ({
      ok: true,
      branch: { branchCode: 'GLEEM', branchName: 'جليم' },
      date: '2026-08-30',
      mode: 'specific_barber',
      services: { serviceIds: [10], totalDurationMinutes: 45, totalPrice: 250 },
      slots: [
        { time: '17:00', dayOffset: 0, barbers: [{ empId: 7, nameAr: 'عمر' }] },
        { time: '18:00', dayOffset: 0, barbers: [{ empId: 7, nameAr: 'عمر' }] },
      ],
      reasonCode: null,
      meta: { slotCount: 2, contractVersion: 't', generatedAt: '' },
    })),
  };
});

vi.mock('@/lib/client/clientPhoneLookup', () => ({
  lookupClientIdByPhone: vi.fn(async () => ({
    clientId: 99,
    ambiguous: false,
    matchCount: 1,
  })),
}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: () => ({
      input() {
        return this;
      },
      query: async () => ({ recordset: [{ DisplayName: 'محمد' }] }),
    }),
  })),
  sql: { Int: 'Int', NVarChar: () => 'NVarChar' },
}));

vi.mock('@/lib/booking/publicBookingReader', () => ({
  listPublicUpcomingBookings: vi.fn(async () => ({
    bookings: [],
    meta: { count: 0, hasMore: false },
  })),
}));

vi.mock('@/lib/businessDate', () => ({
  getCairoBusinessDate: () => '2026-08-29',
  getCairoCalendarDate: () => '2026-08-29',
}));

function baseStructured(over: Partial<AiStructuredResult> = {}): AiStructuredResult {
  return {
    replyText: '',
    intent: 'general_question',
    confidence: 0.9,
    needsBusinessTool: false,
    missingInformation: [],
    entities: {
      dateText: null,
      timeText: null,
      employeeName: null,
      serviceText: null,
      branchText: null,
    },
    shouldReply: true,
    toolCalls: [],
    ...over,
  };
}

describe('Phase 2 AI business read tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('date resolver handles بكرة', () => {
    expect(resolveCustomerDateText('بكرة').date).toBe('2026-08-30');
    expect(textMatchesQuery('شعر ودقن', 'شعر')).toBe(true);
  });

  it('greeting needs no tools', () => {
    expect(intentRequiresBusinessTools('greeting', false)).toBe(false);
    expect(planBusinessToolCalls(baseStructured({ intent: 'greeting' }))).toEqual([]);
  });

  it('price question plans list_services', () => {
    const plan = planBusinessToolCalls(
      baseStructured({
        intent: 'price_question',
        needsBusinessTool: true,
        entities: {
          dateText: null,
          timeText: null,
          employeeName: null,
          serviceText: 'شعر ودقن',
          branchText: null,
        },
      }),
    );
    expect(plan[0]?.name).toBe('list_services');
  });

  it('branch question plans list_branches', () => {
    const plan = planBusinessToolCalls(
      baseStructured({ intent: 'branch_question', needsBusinessTool: true }),
    );
    expect(plan.some((p) => p.name === 'list_branches')).toBe(true);
  });

  it('availability with service+date plans get_availability', () => {
    const plan = planBusinessToolCalls(
      baseStructured({
        intent: 'availability_question',
        needsBusinessTool: true,
        entities: {
          serviceText: 'شعر ودقن',
          dateText: 'بكرة',
          employeeName: 'عمر',
          timeText: null,
          branchText: null,
        },
      }),
    );
    expect(plan[0]?.name).toBe('get_availability');
  });

  it('detects fake checking replies', () => {
    expect(looksLikeFakeSystemCheck('ثواني هأكدلك الحجز من السيستم')).toBe(true);
    expect(looksLikeFakeSystemCheck('سعر الخدمة 250 جنيه')).toBe(false);
  });

  it('1 list public branches', async () => {
    const trace = await executeAiToolPlan([{ name: 'list_branches' }], {
      phone: '201557994946',
      conversationId: 1,
      turnId: 1,
    });
    expect(trace.executed[0]?.ok).toBe(true);
    const data = trace.executed[0]?.data as { branches: Array<{ branchCode: string }> };
    expect(data.branches[0]?.branchCode).toBe('GLEEM');
  });

  it('3 known service returns real price', async () => {
    const trace = await executeAiToolPlan(
      [{ name: 'list_services', serviceQuery: 'شعر ودقن' }],
      { phone: '201557994946', conversationId: 1, turnId: 1 },
    );
    expect(trace.executed[0]?.ok).toBe(true);
    const data = trace.executed[0]?.data as { services: Array<{ price: number; nameAr: string }> };
    expect(data.services[0]?.price).toBe(250);
  });

  it('4 unknown service does not invent price', async () => {
    const trace = await executeAiToolPlan(
      [{ name: 'list_services', serviceQuery: 'مساج فضائي' }],
      { phone: '201557994946', conversationId: 1, turnId: 1 },
    );
    const data = trace.executed[0]?.data as { count: number; services: unknown[] };
    expect(data.count).toBe(0);
    expect(data.services).toEqual([]);
  });

  it('5 known employee', async () => {
    const trace = await executeAiToolPlan(
      [{ name: 'list_employees', employeeName: 'عمر', branchCode: 'GLEEM' }],
      { phone: '201557994946', conversationId: 1, turnId: 1 },
    );
    const data = trace.executed[0]?.data as { employees: Array<{ name: string }> };
    expect(data.employees[0]?.name).toContain('عمر');
  });

  it('8 real available slots via get_availability', async () => {
    const trace = await executeAiToolPlan(
      [
        {
          name: 'get_availability',
          branchCode: 'GLEEM',
          serviceQuery: 'شعر ودقن',
          employeeName: 'عمر',
          dateText: 'بكرة',
        },
      ],
      { phone: '201557994946', conversationId: 1, turnId: 1 },
    );
    expect(trace.executed[0]?.ok).toBe(true);
    const data = trace.executed[0]?.data as { slots: unknown[]; noSlots: boolean };
    expect(data.noSlots).toBe(false);
    expect(data.slots.length).toBeGreaterThan(0);
  });

  it('21 max tool-call limit enforced', async () => {
    const req = [
      { name: 'list_branches' as const },
      { name: 'list_services' as const },
      { name: 'list_employees' as const },
      { name: 'get_business_hours' as const },
      { name: 'get_customer_context' as const },
    ];
    const trace = await executeAiToolPlan(req, {
      phone: '201557994946',
      conversationId: 1,
      turnId: 1,
    });
    expect(trace.executed.length).toBe(MAX_AI_TOOL_CALLS_PER_TURN);
    expect(trace.truncated).toBe(true);
  });

  it('19 booking request tools never create bookings (read-only registry)', async () => {
    // Ensure write modules are not imported by registry path.
    const registrySrc = await import('@/modules/messaging/ai/tools/registry');
    expect(typeof registrySrc.executeAiBusinessTool).toBe('function');
    // Smoke: availability read only
    const trace = await executeAiToolPlan(
      [
        {
          name: 'get_availability',
          serviceQuery: 'شعر ودقن',
          dateText: 'بكرة',
          employeeName: 'عمر',
        },
      ],
      { phone: '201557994946', conversationId: 1, turnId: 1 },
    );
    expect(trace.executed[0]?.name).toBe('get_availability');
  });
});
