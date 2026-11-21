import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  checkIn: '12:20:00',
  status: 'Present',
  bookingStart: '13:00',
  getPool: vi.fn(async () => ({})),
  schemaReady: vi.fn(async () => true),
  getConfig: vi.fn(async () => ({ enabled: true, activatedOn: '2026-11-01' })),
  eligible: vi.fn(() => true),
  financial: vi.fn(async () => ({
    isScheduledWorkingDay: true, scheduledStart: '12:00', scheduledEnd: '22:00',
  })),
  findCase: vi.fn(async () => null as Record<string, unknown> | null),
  upsertCase: vi.fn(async () => ({ caseId: 88, status: 'applied' })),
  exempt: vi.fn(async () => false),
  pay: vi.fn(async () => ({ dailyBasePay: 400, reason: null })),
  upsertLedger: vi.fn(async () => ({ ledgerEntryId: 4001 })),
  voidLedger: vi.fn(async () => 1),
  claim: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
  sendWa: vi.fn(async () => ({ sent: true, skipped: false })),
}));

vi.mock('@/lib/db', () => ({
  getPool: (...args: unknown[]) => m.getPool(...args),
  sql: {
    Int: 'int', Date: 'date', NVarChar: () => 'nvarchar',
  },
}));
vi.mock('../schema', () => ({
  isLateDeductionSchemaReady: (...args: unknown[]) => m.schemaReady(...args),
}));
vi.mock('../config', () => ({
  getLateDeductionConfig: (...args: unknown[]) => m.getConfig(...args),
  isWorkDateEligibleForLateDeduction: (...args: unknown[]) => m.eligible(...args),
}));
vi.mock('../financialWorkSchedule', () => ({
  resolveEmployeeFinancialWorkSchedule: (...args: unknown[]) => m.financial(...args),
}));
vi.mock('../caseTransaction', () => ({
  withLateDeductionCaseLock: async (
    _key: unknown,
    callback: (db: unknown) => Promise<unknown>,
  ) => callback({
    request: () => ({
      input() { return this; },
      async query(statement: string) {
        if (statement.includes('FROM dbo.TblEmpAttendance')) {
          return { recordset: [{
            CheckInTime: m.checkIn,
            Status: m.status,
            ScheduledStartTime: m.bookingStart,
            ScheduledEndTime: '21:00',
          }] };
        }
        return { recordset: [] };
      },
    }),
  }),
}));
vi.mock('../repository', () => ({
  findLateDeductionCase: (...args: unknown[]) => m.findCase(...args),
  upsertLateDeductionCase: (...args: unknown[]) => m.upsertCase(...args),
  isEmployeeLateDeductionExempt: (...args: unknown[]) => m.exempt(...args),
  claimFinalNotified: (...args: unknown[]) => m.claim(...args),
  releaseFinalNotified: (...args: unknown[]) => m.release(...args),
}));
vi.mock('../dailyBasePay', () => ({
  resolveLateDeductionDailyBasePay: (...args: unknown[]) => m.pay(...args),
}));
vi.mock('../ledger', () => ({
  upsertLateDeductionLedgerEntry: (...args: unknown[]) => m.upsertLedger(...args),
  voidLateDeductionLedgerEntry: (...args: unknown[]) => m.voidLedger(...args),
}));
vi.mock('../whatsapp', () => ({
  sendLateDeductionWhatsApp: (...args: unknown[]) => m.sendWa(...args),
}));

import { finalizeLateDeductionOnCheckIn } from '../finalizeOnCheckIn';

const params = {
  empId: 11, branchId: 2, workDate: '2026-11-14',
  attendanceId: 44, checkInTime: '12:20',
  // Deliberately stale/booking-based values: production must ignore them.
  scheduledStart: '13:00', scheduledEnd: '21:00',
  suppressWhatsApp: true,
};

describe('financial finalization ignores booking window and stale attendance snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.checkIn = '12:20:00';
    m.status = 'Present';
    m.bookingStart = '13:00';
    m.schemaReady.mockResolvedValue(true);
    m.eligible.mockReturnValue(true);
    m.financial.mockResolvedValue({
      isScheduledWorkingDay: true, scheduledStart: '12:00', scheduledEnd: '22:00',
    });
    m.findCase.mockResolvedValue(null);
    m.upsertCase.mockResolvedValue({ caseId: 88, status: 'applied' });
    m.pay.mockResolvedValue({ dailyBasePay: 400, reason: null });
    m.exempt.mockResolvedValue(false);
    m.upsertLedger.mockResolvedValue({ ledgerEntryId: 4001 });
  });

  it.each([
    ['12:00:00', 'skipped', 'none', 0, null],
    ['12:01:00', 'skipped', 'none', 1, null],
    ['12:14:00', 'skipped', 'none', 14, null],
    ['12:15:00', 'applied', 'quarter', 15, 100],
    ['12:20:00', 'applied', 'quarter', 20, 100],
    ['13:00:00', 'applied', 'quarter', 60, 100],
    ['13:01:00', 'applied', 'half', 61, 200],
    ['14:00:00', 'applied', 'half', 120, 200],
    ['14:01:00', 'pending_manager', 'manager_review', 121, null],
  ] as const)('check-in %s => %s/%s, %i minutes, amount %s', async (
    checkIn, status, bracket, minutes, amount,
  ) => {
    m.checkIn = checkIn;
    const result = await finalizeLateDeductionOnCheckIn(params);
    expect(result).toMatchObject({
      handled: true, status, bracket, lateMinutes: minutes, amount,
    });
    expect(m.financial).toHaveBeenCalledWith(expect.objectContaining({
      empId: 11, branchId: 2, workDate: '2026-11-14',
    }));
    if (amount !== null) {
      expect(m.upsertLedger).toHaveBeenCalledTimes(1);
      expect(m.upsertLedger).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        amount, lateMinutes: minutes, branchId: 2,
      }));
      expect(m.pay).toHaveBeenCalledWith(expect.objectContaining({
        scheduledStart: '12:00', scheduledEnd: '22:00',
      }));
      expect(m.upsertCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        scheduledStart: '12:00', lateMinutes: minutes,
      }));
    } else {
      expect(m.upsertLedger).not.toHaveBeenCalled();
    }
    expect(m.sendWa).not.toHaveBeenCalled(); // suppressed in these acceptance cases
  });

  it('notifies in Arabic only after a successful quarter-day debit', async () => {
    const result = await finalizeLateDeductionOnCheckIn({
      ...params, suppressWhatsApp: false,
    });
    expect(result.status).toBe('applied');
    expect(m.upsertLedger).toHaveBeenCalledOnce();
    expect(m.sendWa).toHaveBeenCalledOnce();
    const message = (m.sendWa.mock.calls as unknown as Array<Array<unknown>>)[0]?.[0] as { text: string; metadata: { event: string } };
    expect(message.metadata.event).toBe('final_deduction');
    expect(message.text).toContain('مدة التأخير');
    expect(message.text).toContain('100.00');
    expect(message.text).toContain('ربع يوم');
    expect(message.text).not.toMatch(/Attendance|Check-in|Escalation|EGP/i);
  });

  it('does not notify when a debit failed to write', async () => {
    m.upsertLedger.mockRejectedValueOnce(new Error('ledger failed'));
    const result = await finalizeLateDeductionOnCheckIn({
      ...params, suppressWhatsApp: false,
    });
    expect(result.status).toBe('finalize_pending');
    expect(m.sendWa).not.toHaveBeenCalled();
  });

  it.each([
    ['12:01:00', 'within_grace_period'],
    ['12:14:00', 'within_grace_period'],
    ['14:01:00', undefined],
  ] as const)('no WhatsApp for arrival %s without applied penalty', async (checkIn, reason) => {
    m.checkIn = checkIn;
    const result = await finalizeLateDeductionOnCheckIn({
      ...params, suppressWhatsApp: false,
    });
    if (reason) expect(result.reason).toBe(reason);
    expect(m.upsertLedger).not.toHaveBeenCalled();
    expect(m.sendWa).not.toHaveBeenCalled();
  });

  it('does not notify exempt employee even with no WhatsApp suppression', async () => {
    m.exempt.mockResolvedValueOnce(true);
    const result = await finalizeLateDeductionOnCheckIn({
      ...params, suppressWhatsApp: false,
    });
    expect(result.status).toBe('exempt');
    expect(m.upsertLedger).not.toHaveBeenCalled();
    expect(m.sendWa).not.toHaveBeenCalled();
  });

  it('on-time correction at 14 minutes voids prior debit', async () => {
    m.checkIn = '12:14:00';
    m.findCase.mockResolvedValueOnce({
      caseId: 77, status: 'applied', ledgerEntryId: 4001, attendanceId: 44,
      doNotAutoRecreate: false,
    });
    const result = await finalizeLateDeductionOnCheckIn(params);
    expect(result).toMatchObject({
      status: 'skipped', reason: 'within_grace_period', lateMinutes: 14,
    });
    expect(m.voidLedger).toHaveBeenCalledOnce();
    expect(m.upsertLedger).not.toHaveBeenCalled();
  });

  it('does not charge on HR weekly day off even if booking slots are available', async () => {
    m.financial.mockResolvedValueOnce({
      isScheduledWorkingDay: false, scheduledStart: null, scheduledEnd: null,
    });
    m.findCase.mockResolvedValueOnce({
      caseId: 77, status: 'applied', ledgerEntryId: 4001, attendanceId: 44,
      doNotAutoRecreate: false,
    });
    const result = await finalizeLateDeductionOnCheckIn(params);
    expect(result).toMatchObject({
      handled: true, status: 'skipped', reason: 'financial_workday_not_scheduled',
    });
    expect(m.voidLedger).toHaveBeenCalledOnce();
    expect(m.upsertLedger).not.toHaveBeenCalled();
  });

  it.each(['absent', 'off', 'Excused', 'DayOff'])(
    'never charges %s even with saved check-in time', async (status) => {
      m.status = status;
      const result = await finalizeLateDeductionOnCheckIn(params);
      expect(result.status).toBe('skipped');
      expect(m.upsertLedger).not.toHaveBeenCalled();
    },
  );

  it('exempt employee gets no ledger debit even when HR says 20 minutes late', async () => {
    m.exempt.mockResolvedValueOnce(true);
    const result = await finalizeLateDeductionOnCheckIn(params);
    expect(result).toMatchObject({
      handled: true, status: 'exempt', lateMinutes: 20, amount: null,
    });
    expect(m.upsertLedger).not.toHaveBeenCalled();
  });

  it('on-time correction voids earlier automatic debit using current HR shift', async () => {
    m.checkIn = '11:59:00';
    m.findCase.mockResolvedValueOnce({
      caseId: 77, status: 'applied', ledgerEntryId: 4001, attendanceId: 44,
      doNotAutoRecreate: false,
    });
    const result = await finalizeLateDeductionOnCheckIn(params);
    expect(result).toMatchObject({ reason: 'on_time', status: 'skipped', lateMinutes: 0 });
    expect(m.voidLedger).toHaveBeenCalledOnce();
    expect(m.upsertLedger).not.toHaveBeenCalled();
  });

  it('does not produce retroactive penalty before activation', async () => {
    m.eligible.mockReturnValueOnce(false);
    const result = await finalizeLateDeductionOnCheckIn(params);
    expect(result).toMatchObject({
      handled: false, reason: 'feature_disabled_or_before_activation',
    });
    expect(m.financial).not.toHaveBeenCalled();
    expect(m.upsertLedger).not.toHaveBeenCalled();
  });
});
