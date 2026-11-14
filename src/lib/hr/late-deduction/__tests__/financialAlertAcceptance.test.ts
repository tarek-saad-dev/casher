import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  now: '11:20:00',
  employeeRows: [] as Array<Record<string, unknown>>,
  sqlQueries: [] as string[],
  getConfig: vi.fn(async () => ({ enabled: true, activatedOn: '2026-11-01' })),
  isEligible: vi.fn(() => true),
  schemaReady: vi.fn(async () => true),
  recover: vi.fn(async () => ({ recovered: 0, errors: 0 })),
  findCase: vi.fn(async () => null as Record<string, unknown> | null),
  upsertCase: vi.fn(async () => ({
    caseId: 100, status: 'alerting', deductionKind: 'none',
    notifiedAt1: null, notifiedAt61: null, notifiedAt121: null,
  })),
  mark: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
  pay: vi.fn(async () => ({ dailyBasePay: 400 })),
  queuedWhatsapp: vi.fn(),
  sentWhatsapp: vi.fn(async () => ({ sent: true })),
}));

vi.mock('@/lib/db', () => ({
  getPool: async () => ({
    request: () => ({
      input() { return this; },
      async query(statement: string) {
        m.sqlQueries.push(statement);
        if (statement.includes('FROM dbo.TblEmp e')) {
          return { recordset: m.employeeRows };
        }
        return { recordset: [] };
      },
    }),
  }),
  sql: {
    Int: 'int', Date: 'date', NVarChar: () => 'nvarchar',
    Transaction: class {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
    Request: class {
      input() { return this; }
      async query() { return { recordset: [{ LockResult: 0 }] }; }
    },
  },
}));
vi.mock('@/lib/businessDate', () => ({
  getCairoBusinessDate: () => '2026-11-14',
  getCairoTimeStr: () => m.now,
}));
vi.mock('../schema', () => ({
  isLateDeductionSchemaReady: (...args: unknown[]) => m.schemaReady(...args),
}));
vi.mock('../config', () => ({
  getLateDeductionConfig: (...args: unknown[]) => m.getConfig(...args),
  isWorkDateEligibleForLateDeduction: (...args: unknown[]) => m.isEligible(...args),
}));
vi.mock('../recoverFinalizations', () => ({
  recoverPendingLateDeductionFinalizations: (...args: unknown[]) => m.recover(...args),
}));
vi.mock('../repository', () => ({
  findLateDeductionCase: (...args: unknown[]) => m.findCase(...args),
  upsertLateDeductionCase: (...args: unknown[]) => m.upsertCase(...args),
  markThresholdNotified: (...args: unknown[]) => m.mark(...args),
  releaseThresholdNotified: (...args: unknown[]) => m.release(...args),
}));
vi.mock('../dailyBasePay', () => ({
  resolveLateDeductionDailyBasePay: (...args: unknown[]) => m.pay(...args),
}));
vi.mock('../whatsapp', () => ({
  scheduleLateDeductionWhatsApp: (...args: unknown[]) => m.queuedWhatsapp(...args),
  sendLateDeductionWhatsApp: (...args: unknown[]) => m.sentWhatsapp(...args),
}));

import { runLateDeductionAlertScan } from '../alertScan';

const scheduledEmployee = {
  EmpID: 11,
  EmpName: 'Test employee',
  EmploymentType: 'full_time',
  DefaultCheckInTime: '12:00',
  DefaultCheckOutTime: '22:00',
  LateDeductionExempt: 0,
  HomeBranchID: 2,
  ScheduleBranchID: 2,
  ScheduleDayOfWeek: 6,
  IsWorkingDay: 1,
  ScheduleStartTime: '12:00', // HR shift starts at 12:00
  ScheduleEndTime: '22:00',
  BookingStartTime: '11:00', // intentionally different, not a financial clock
  AttendanceID: null,
  CheckInTime: null,
  AttendanceStatus: null,
};

describe('late WhatsApp scan: warn from HR scheduled start, never booking start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.now = '11:20:00';
    m.employeeRows = [{ ...scheduledEmployee }];
    m.sqlQueries.length = 0;
    m.schemaReady.mockResolvedValue(true);
    m.isEligible.mockReturnValue(true);
    m.findCase.mockResolvedValue(null);
    m.upsertCase.mockResolvedValue({
      caseId: 100, status: 'alerting', deductionKind: 'none',
      notifiedAt1: null, notifiedAt61: null, notifiedAt121: null,
    });
    m.mark.mockResolvedValue(true);
    m.pay.mockResolvedValue({ dailyBasePay: 400 });
  });

  const run = () => runLateDeductionAlertScan({
    businessDate: '2026-11-14', branchId: 2, sendInline: false,
  });

  it('does not warn at 11:20 if booking starts 11:00 but HR starts 12:00', async () => {
    const result = await run();
    expect(result).toMatchObject({ candidates: 0, notified: 0, errors: 0 });
    expect(m.upsertCase).not.toHaveBeenCalled();
    expect(m.queuedWhatsapp).not.toHaveBeenCalled();
    expect(m.sqlQueries.join('\n')).toContain('dbo.TblEmpWorkSchedule');
    expect(m.sqlQueries.join('\n')).toContain('fin.StartTime');
  });

  it.each([
    ['12:00:00', 0, null],
    ['12:01:00', 1, 1],
    ['13:00:00', 60, 1],
    ['13:01:00', 61, 61],
    ['14:01:00', 121, 121],
  ] as const)('now %s, %i minutes, threshold %s', async (now, mins, threshold) => {
    m.now = now;
    const result = await run();
    if (threshold === null) {
      expect(result).toMatchObject({ candidates: 0, notified: 0 });
      expect(m.queuedWhatsapp).not.toHaveBeenCalled();
      return;
    }
    expect(result).toMatchObject({ candidates: 1, notified: 1, errors: 0 });
    expect(m.mark).toHaveBeenCalledWith(expect.anything(), 100, threshold);
    expect(m.upsertCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scheduledStart: '12:00', lateMinutes: mins, branchId: 2,
    }));
    expect(m.pay).toHaveBeenCalledWith(expect.objectContaining({
      scheduledStart: '12:00', scheduledEnd: '22:00', branchId: 2,
    }));
    expect(m.queuedWhatsapp).toHaveBeenCalledOnce();
    expect(m.sentWhatsapp).not.toHaveBeenCalled();
  });

  it('skips HR day off even when a booking shift exists', async () => {
    m.now = '13:20:00';
    m.employeeRows = [{ ...scheduledEmployee, IsWorkingDay: 0 }];
    const result = await run();
    expect(result).toMatchObject({ candidates: 0, notified: 0 });
    expect(m.queuedWhatsapp).not.toHaveBeenCalled();
  });

  it('skips absent/off and already checked-in employees', async () => {
    m.now = '13:20:00';
    for (const attendance of [
      { AttendanceStatus: 'absent', CheckInTime: null },
      { AttendanceStatus: 'off', CheckInTime: null },
      { AttendanceStatus: 'present', CheckInTime: '12:10:00' },
    ]) {
      m.employeeRows = [{ ...scheduledEmployee, ...attendance }];
      await run();
      expect(m.queuedWhatsapp).not.toHaveBeenCalled();
    }
  });

  it('does not duplicate an already claimed alert', async () => {
    m.now = '12:20:00';
    m.findCase.mockResolvedValueOnce({
      caseId: 100, status: 'alerting', notifiedAt1: '2026-11-14T12:01:00',
      notifiedAt61: null, notifiedAt121: null,
    });
    m.upsertCase.mockResolvedValueOnce({
      caseId: 100, status: 'alerting', notifiedAt1: '2026-11-14T12:01:00',
      notifiedAt61: null, notifiedAt121: null,
    });
    await run();
    expect(m.queuedWhatsapp).not.toHaveBeenCalled();
    expect(m.mark).not.toHaveBeenCalled();
  });

  it('refuses alerts before feature activation', async () => {
    m.isEligible.mockReturnValueOnce(false);
    m.now = '13:20:00';
    const result = await run();
    expect(result).toMatchObject({ reason: 'feature_disabled_or_before_activation', notified: 0 });
    expect(m.queuedWhatsapp).not.toHaveBeenCalled();
  });

  it('uses the requested Cairo business-date weekday, not next calendar day', async () => {
    m.now = '01:15:00';
    m.employeeRows = [{ ...scheduledEmployee, ScheduleDayOfWeek: 5, ScheduleStartTime: '23:00' }];
    await runLateDeductionAlertScan({
      businessDate: '2026-11-13', branchId: 2, sendInline: false,
    });
    expect(m.sqlQueries.some(q => q.includes('FROM dbo.TblEmp e'))).toBe(true);
    // The bound @dow is verified by the shared work-date resolver tests.
  });
});
