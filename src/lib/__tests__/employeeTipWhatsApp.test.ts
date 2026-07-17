import { describe, expect, it } from 'vitest';
import { composeEmployeeTipWhatsAppMessage } from '@/lib/hr/tip-whatsapp-message';
import { buildOtherPayload } from '@/lib/integrations/whatsapp/payload-builders';
import { validateOtherPayload } from '@/lib/integrations/whatsapp/schemas';

describe('composeEmployeeTipWhatsAppMessage', () => {
  it('includes tip amount and new balance', () => {
    const message = composeEmployeeTipWhatsAppMessage({
      employeeName: 'أحمد',
      tipAmount: 50,
      invoiceTotal: 200,
      amountPaid: 250,
      newBalance: 350,
      paymentMethod: 'كاش',
    });

    expect(message).toContain('أحمد');
    expect(message).toContain('50.00');
    expect(message).toContain('250.00');
    expect(message).toContain('200.00');
    expect(message).toContain('350.00');
    expect(message).toContain('كاش');
  });

  it('omits payment line when method missing', () => {
    const message = composeEmployeeTipWhatsAppMessage({
      employeeName: 'محمود',
      tipAmount: 30,
      invoiceTotal: 100,
      amountPaid: 130,
      newBalance: 130,
    });

    expect(message).not.toContain('طريقة الدفع');
  });
});

describe('tip message sent as type=other', () => {
  it('builds and validates an other payload carrying the composed message', () => {
    const message = composeEmployeeTipWhatsAppMessage({
      employeeName: 'أحمد',
      tipAmount: 50,
      invoiceTotal: 200,
      amountPaid: 250,
      newBalance: 350,
      paymentMethod: 'كاش',
    });

    const payload = buildOtherPayload({
      phone: '01557994946',
      customerName: 'أحمد',
      message,
    });

    expect(payload.type).toBe('other');
    expect(validateOtherPayload(payload).message).toBe(message);
  });
});
