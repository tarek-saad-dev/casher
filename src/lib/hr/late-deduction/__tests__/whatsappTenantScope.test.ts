import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = {
  getPool: vi.fn(),
  sendMessage: vi.fn(async () => ({ sent: true, channel: 'whatsapp' })),
  runWithBranch: vi.fn(async (_b: number, _d: string, fn: () => Promise<unknown>) => fn()),
  resolvePhone: vi.fn(() => '201000000000'),
};

vi.mock('@/lib/db', () => ({
  getPool: (...a: unknown[]) => m.getPool(...a),
  sql: { Int: 'Int' },
}));
vi.mock('@/modules/messaging', () => ({
  sendMessage: (...a: unknown[]) => m.sendMessage(...a),
}));
vi.mock('@/modules/messaging/tenancy/branchTenantScope', () => ({
  runWithMessagingTenantForBranch: (...a: unknown[]) =>
    m.runWithBranch(...(a as [number, string, () => Promise<unknown>])),
}));
vi.mock('@/lib/integrations/whatsapp/payload-builders', () => ({
  resolveEmployeeWhatsAppPhone: (...a: unknown[]) => m.resolvePhone(...a),
}));

describe('sendLateDeductionWhatsApp tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.resolvePhone.mockReturnValue('201000000000');
    m.sendMessage.mockResolvedValue({ sent: true, channel: 'whatsapp' });
    m.runWithBranch.mockImplementation(async (_b, _d, fn) => fn());
    const query = vi.fn(async () => ({
      recordset: [{ WhatsApp: '01000000000', Mobile: null, EmpName: 'Test' }],
    }));
    const input = vi.fn(function (this: { query: typeof query }) {
      return this;
    });
    m.getPool.mockResolvedValue({
      request: () => {
        const chain = { input, query };
        input.mockReturnValue(chain);
        return chain;
      },
    });
  });

  it('rejects obsolete attendance warnings and escalation even with a recipient', async () => {
    const { sendLateDeductionWhatsApp } = await import('../whatsapp');
    for (const event of ['alert_1', 'alert_61', 'alert_121', 'manager_review', 'exempt_checkin']) {
      expect(await sendLateDeductionWhatsApp({
        empId: 42, branchId: 10, text: 'رسالة ممنوعة', metadata: { event },
      })).toMatchObject({ sent: false, skipped: true, reason: 'non_penalty_event' });
    }
    expect(m.runWithBranch).not.toHaveBeenCalled();
    expect(m.sendMessage).not.toHaveBeenCalled();
  });

  it('binds messaging tenant from branch before sendMessage', async () => {
    const { sendLateDeductionWhatsApp } = await import('../whatsapp');
    await expect(
      sendLateDeductionWhatsApp({
        empId: 42,
        branchId: 10,
        text: 'خصم تأخير',
        metadata: { event: 'final_deduction' },
      }),
    ).resolves.toEqual({ sent: true });

    expect(m.runWithBranch).toHaveBeenCalledWith(
      10,
      'late-deduction-whatsapp',
      expect.any(Function),
    );
    expect(m.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        content: { text: 'خصم تأخير' },
        metadata: expect.objectContaining({
          feature: 'late_deduction',
          event: 'final_deduction',
          branchId: 10,
        }),
      }),
    );
  });
});
