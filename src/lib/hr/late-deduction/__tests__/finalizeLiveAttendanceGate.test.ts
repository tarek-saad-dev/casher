import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = {
  getPool: vi.fn(),
  withLock: vi.fn(async (_k: unknown, cb: (db: unknown) => Promise<unknown>) =>
    cb({ request: () => ({ input: () => ({ query: vi.fn() }) }) }),
  ),
  schemaOk: vi.fn(async () => true),
  config: vi.fn(async () => ({
    enabled: true,
    activationDate: '2020-01-01',
  })),
  eligible: vi.fn(() => true),
  findCase: vi.fn(),
  upsertCase: vi.fn(),
  voidLedger: vi.fn(async () => 1),
  upsertLedger: vi.fn(),
  exempt: vi.fn(async () => false),
  pay: vi.fn(async () => ({ dailyBasePay: 260, reason: null })),
  claim: vi.fn(async () => true),
  release: vi.fn(),
  sendWa: vi.fn(async () => ({ sent: true, skipped: false })),
};

vi.mock('@/lib/db', () => ({
  getPool: (...a: unknown[]) => m.getPool(...a),
  sql: {
    Int: 'Int',
    NVarChar: () => 'NVarChar',
    Date: 'Date',
    Decimal: () => 'Decimal',
    Transaction: class {},
    Request: class {},
  },
}));
vi.mock('../caseTransaction', () => ({
  withLateDeductionCaseLock: (...a: unknown[]) => m.withLock(...(a as [never, never])),
}));
vi.mock('../schema', () => ({
  isLateDeductionSchemaReady: (...a: unknown[]) => m.schemaOk(...a),
}));
vi.mock('../config', () => ({
  getLateDeductionConfig: (...a: unknown[]) => m.config(...a),
  isWorkDateEligibleForLateDeduction: (...a: unknown[]) => m.eligible(...a),
}));
vi.mock('../repository', () => ({
  findLateDeductionCase: (...a: unknown[]) => m.findCase(...a),
  upsertLateDeductionCase: (...a: unknown[]) => m.upsertCase(...a),
  isEmployeeLateDeductionExempt: (...a: unknown[]) => m.exempt(...a),
  claimFinalNotified: (...a: unknown[]) => m.claim(...a),
  releaseFinalNotified: (...a: unknown[]) => m.release(...a),
}));
vi.mock('../ledger', () => ({
  upsertLateDeductionLedgerEntry: (...a: unknown[]) => m.upsertLedger(...a),
  voidLateDeductionLedgerEntry: (...a: unknown[]) => m.voidLedger(...a),
}));
vi.mock('../dailyBasePay', () => ({
  resolveLateDeductionDailyBasePay: (...a: unknown[]) => m.pay(...a),
}));
vi.mock('../whatsapp', () => ({
  sendLateDeductionWhatsApp: (...a: unknown[]) => m.sendWa(...a),
}));

function makeDb(live: {
  CheckInTime: string | null;
  Status: string | null;
  ScheduledStartTime?: string | null;
  ScheduledEndTime?: string | null;
}) {
  const query = vi.fn(async (sqlText: string) => {
    if (/FROM dbo\.TblEmpAttendance/i.test(sqlText)) {
      return { recordset: [live] };
    }
    return { recordset: [] };
  });
  const input = vi.fn(function (this: { query: typeof query }) {
    return this;
  });
  return {
    request: () => {
      const req = { input, query };
      input.mockImplementation(function (this: typeof req) {
        return this;
      });
      return req;
    },
  };
}

describe('finalizeLateDeductionOnCheckIn live attendance gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.schemaOk.mockResolvedValue(true);
    m.eligible.mockReturnValue(true);
    m.config.mockResolvedValue({ enabled: true, activationDate: '2020-01-01' });
    m.exempt.mockResolvedValue(false);
    m.pay.mockResolvedValue({ dailyBasePay: 260, reason: null });
    m.findCase.mockResolvedValue({
      caseId: 9,
      status: 'alerting',
      ledgerEntryId: 77,
      attendanceId: 55,
      amount: 65,
      lateMinutes: 30,
      dailyBasePay: 260,
      doNotAutoRecreate: false,
      notifiedFinalAt: null,
    });
    m.upsertCase.mockResolvedValue({ caseId: 9, status: 'skipped' });
    m.withLock.mockImplementation(async (_k: unknown, cb: (db: unknown) => Promise<unknown>) =>
      cb(makeDb({ CheckInTime: '10:30:00', Status: 'Present', ScheduledStartTime: '09:00' })),
    );
  });

  it('voids instead of charging when live status is absent (stale finalize race)', async () => {
    m.withLock.mockImplementation(async (_k: unknown, cb: (db: unknown) => Promise<unknown>) =>
      cb(makeDb({ CheckInTime: '10:30:00', Status: 'absent', ScheduledStartTime: '09:00' })),
    );
    const { finalizeLateDeductionOnCheckIn } = await import('../finalizeOnCheckIn');
    const result = await finalizeLateDeductionOnCheckIn({
      empId: 1,
      branchId: 10,
      workDate: '2026-11-08',
      attendanceId: 55,
      checkInTime: '10:30',
      scheduledStart: '09:00',
      scheduledEnd: '18:00',
      suppressWhatsApp: true,
    });
    expect(result.reason).toBe('excluded_attendance_status');
    expect(result.status).toBe('skipped');
    expect(m.voidLedger).toHaveBeenCalled();
    expect(m.upsertLedger).not.toHaveBeenCalled();
    expect(m.upsertCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'skipped', amount: null, lateMinutes: 0 }),
    );
  });

  it('voids instead of charging when live check-in was cleared', async () => {
    m.withLock.mockImplementation(async (_k: unknown, cb: (db: unknown) => Promise<unknown>) =>
      cb(makeDb({ CheckInTime: null, Status: 'Present', ScheduledStartTime: '09:00' })),
    );
    const { finalizeLateDeductionOnCheckIn } = await import('../finalizeOnCheckIn');
    const result = await finalizeLateDeductionOnCheckIn({
      empId: 1,
      branchId: 10,
      workDate: '2026-11-08',
      attendanceId: 55,
      checkInTime: '10:30',
      scheduledStart: '09:00',
      scheduledEnd: '18:00',
      suppressWhatsApp: true,
    });
    expect(result.reason).toBe('checkin_cleared');
    expect(m.voidLedger).toHaveBeenCalled();
    expect(m.upsertLedger).not.toHaveBeenCalled();
  });
});
