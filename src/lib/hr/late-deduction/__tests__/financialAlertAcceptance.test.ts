import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  recovery: vi.fn(async () => ({
    scanned: 2, recovered: 1, errors: 0, workDate: '2026-11-18',
  })),
  eligible: vi.fn(() => true),
  schema: vi.fn(async () => true),
  config: vi.fn(async () => ({ enabled: true, activatedOn: '2026-11-15' })),
  employeeQuery: vi.fn(),
  waSend: vi.fn(),
  waSchedule: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getPool: async () => ({
    request: () => ({
      input() { return this; },
      query: m.employeeQuery,
    }),
  }),
  sql: {
    Transaction: class {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
    Request: class {
      input() { return this; }
      async query() { return { recordset: [{ LockResult: 0 }] }; }
    },
    NVarChar: () => 'nvarchar',
  },
}));
vi.mock('@/lib/businessDate', () => ({ getCairoBusinessDate: () => '2026-11-18' }));
vi.mock('../schema', () => ({
  isLateDeductionSchemaReady: (...a: unknown[]) => m.schema(...a),
}));
vi.mock('../config', () => ({
  getLateDeductionConfig: (...a: unknown[]) => m.config(...a),
  isWorkDateEligibleForLateDeduction: (...a: unknown[]) => m.eligible(...a),
}));
vi.mock('../recoverFinalizations', () => ({
  recoverPendingLateDeductionFinalizations: (...a: unknown[]) => m.recovery(...a),
}));
vi.mock('../whatsapp', () => ({
  sendLateDeductionWhatsApp: m.waSend,
  scheduleLateDeductionWhatsApp: m.waSchedule,
}));

import { runLateDeductionAlertScan } from '../alertScan';

describe('cron recovery-only — no pre-check-in warnings or 121-minute escalations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.schema.mockResolvedValue(true);
    m.eligible.mockReturnValue(true);
    m.config.mockResolvedValue({ enabled: true, activatedOn: '2026-11-15' });
    m.recovery.mockResolvedValue({
      scanned: 2, recovered: 1, errors: 0, workDate: '2026-11-18',
    });
  });

  it.each([1, 14, 15, 60, 61, 120, 121, 240])(
    'never sends pre-attendance WhatsApp even when %i minutes have elapsed',
    async (_minutes) => {
      const result = await runLateDeductionAlertScan({
        businessDate: '2026-11-18', branchId: 2, sendInline: true,
      });
      expect(result).toMatchObject({
        notified: 0, candidates: 0, recoveredFinalizations: 1, recoveryErrors: 0,
      });
      expect(m.recovery).toHaveBeenCalledOnce();
      expect(m.employeeQuery).not.toHaveBeenCalled();
      expect(m.waSend).not.toHaveBeenCalled();
      expect(m.waSchedule).not.toHaveBeenCalled();
    },
  );

  it('keeps cron recovery working even though warnings are cancelled', async () => {
    const result = await runLateDeductionAlertScan({ branchId: 2 });
    expect(result).toMatchObject({
      notified: 0, recoveredFinalizations: 1, workDate: '2026-11-18',
    });
    expect(m.recovery).toHaveBeenCalledWith({
      businessDate: '2026-11-18', branchId: 2,
    });
  });

  it('feature disabled means no WhatsApp and no recovery', async () => {
    m.eligible.mockReturnValueOnce(false);
    const result = await runLateDeductionAlertScan({ branchId: 2 });
    expect(result.reason).toBe('feature_disabled_or_before_activation');
    expect(m.recovery).not.toHaveBeenCalled();
    expect(m.waSend).not.toHaveBeenCalled();
  });
});
