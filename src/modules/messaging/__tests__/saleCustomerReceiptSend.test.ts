import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { sendWhatsAppMessage, getWhatsAppConfig, lookupActiveMessageTemplate } = vi.hoisted(() => ({
  sendWhatsAppMessage: vi.fn(),
  getWhatsAppConfig: vi.fn(),
  lookupActiveMessageTemplate: vi.fn(async () => null),
}));

vi.mock('@/lib/integrations/whatsapp', () => ({
  sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessage(...args),
  getWhatsAppConfig: (...args: unknown[]) => getWhatsAppConfig(...args),
}));

vi.mock('@/modules/messaging/templates/repository/messageTemplateRepository', () => ({
  lookupActiveMessageTemplate: (...args: unknown[]) => lookupActiveMessageTemplate(...args),
}));

import { sendSaleCustomerReceipt } from '@/modules/messaging';

function config(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    saleEnabled: true,
    defaultBranchName: 'جليم',
    ...overrides,
  };
}

describe('sendSaleCustomerReceipt', () => {
  beforeEach(() => {
    sendWhatsAppMessage.mockReset();
    getWhatsAppConfig.mockReset();
    lookupActiveMessageTemplate.mockReset();
    lookupActiveMessageTemplate.mockResolvedValue(null);
    getWhatsAppConfig.mockReturnValue(config());
    sendWhatsAppMessage.mockResolvedValue({
      sent: true,
      skipped: false,
      status: 'sent',
      messageId: 'wa-sale-1',
    });
  });

  it('sends a generic Gateway body without type and with the default sale text', async () => {
    const result = await sendSaleCustomerReceipt({
      phone: '01557994946',
      customerName: 'طارق',
      invoiceId: 10025,
      total: 350,
      paymentMethod: 'كاش',
      services: ['حلاقة شعر', 'تحديد دقن'],
      employeeNames: ['محمد'],
      branchName: 'جليم',
      branchId: 3,
    });

    expect(result).toEqual({
      sent: true,
      channel: 'whatsapp',
      messageId: 'wa-sale-1',
    });
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith({
      phone: '01557994946',
      message: `أستاذ طارق
نورت Cut Salon ودايمًا منورنا 🙏✨`,
      metadata: {
        source: 'sale.customer_receipt',
        templateKey: 'sale.customer_receipt',
        branchId: 3,
        invoiceId: 10025,
      },
    });
    const body = sendWhatsAppMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('type');
    expect(Object.keys(body).sort()).toEqual(['message', 'metadata', 'phone']);
  });

  it('does not treat disabled/failure as success', async () => {
    getWhatsAppConfig.mockReturnValue(config({ enabled: false }));
    const disabled = await sendSaleCustomerReceipt({
      phone: '01557994946',
      customerName: 'طارق',
      invoiceId: 1,
      total: 100,
    });
    expect(disabled.sent).toBe(false);
    if (!disabled.sent) expect(disabled.reason).toBe('development_only');
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();

    getWhatsAppConfig.mockReturnValue(config());
    sendWhatsAppMessage.mockResolvedValue({
      sent: false,
      skipped: false,
      reason: 'timeout',
    });
    const timedOut = await sendSaleCustomerReceipt({
      phone: '01557994946',
      customerName: 'طارق',
      invoiceId: 1,
      total: 100,
    });
    expect(timedOut.sent).toBe(false);
    if (!timedOut.sent) expect(timedOut.reason).toBe('timeout');
  });

  it('skips missing customer name without calling WhatsApp', async () => {
    const result = await sendSaleCustomerReceipt({
      phone: '01557994946',
      customerName: '  ',
      invoiceId: 1,
      total: 100,
    });
    expect(result).toMatchObject({
      sent: false,
      reason: 'missing_customer_name',
      skipped: true,
    });
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/sales customer WhatsApp wiring', () => {
  it('sends the customer receipt through Messaging Module and migrates other sale WhatsApp to sendTemplateMessage', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/app/api/sales/route.ts'), 'utf8');
    expect(src).toContain("@/modules/messaging");
    expect(src).toContain('sendSaleCustomerReceipt');
    expect(src).toContain('sendTemplateMessage');
    expect(src).toContain('CUSTOMER_FIRST_TIME_TEMPLATE_KEY');
    expect(src).toContain('SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY');
    expect(src).not.toContain('sendSaleWhatsAppMessage');
    expect(src).not.toContain('sendFirstTimeWhatsAppMessage');
    expect(src).not.toContain('sendEmployeeSaleWhatsAppMessage');
    expect(src).toContain('branchName: gated.branch.branchName');
    expect(src).toContain('void (async () => {');
    expect(src).toContain('WhatsApp error (non-critical)');
  });
});
