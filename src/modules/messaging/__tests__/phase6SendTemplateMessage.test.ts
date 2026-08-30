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

import { sendTemplateMessage } from '@/modules/messaging/application/sendTemplateMessage';
import {
  BOOKING_CANCELLATION_DEFAULT_TEMPLATE,
  BOOKING_CANCELLATION_TEMPLATE_KEY,
  BOOKING_CONFIRMATION_DEFAULT_TEMPLATE,
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
  CUSTOMER_FIRST_TIME_DEFAULT_TEMPLATE,
  CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
  SALE_EMPLOYEE_NOTIFICATION_DEFAULT_TEMPLATE,
} from '@/modules/messaging/templates/catalog';
import { listWhatsAppTemplateDefinitions } from '@/modules/messaging/templates/definitions';
import { renderTemplate } from '@/modules/messaging/templates/renderTemplate';

function config(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    saleEnabled: true,
    firstTimeEnabled: true,
    employeeSaleEnabled: true,
    bookingEnabled: true,
    employeeAdvanceEnabled: true,
    employeeFundingEnabled: true,
    employeeDailyReportEnabled: true,
    ownerDailyReportEnabled: true,
    otherEnabled: true,
    quickMessageEnabled: true,
    defaultBranchName: 'جليم',
    defaultBookingLink: 'https://cutsaloon.com/',
    ...overrides,
  };
}

function src(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('sendTemplateMessage', () => {
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
      messageId: 'wa-tpl-1',
    });
  });

  it('composes + generic-sends without type and auto-fills templateKey/source', async () => {
    const result = await sendTemplateMessage({
      templateKey: CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
      recipient: { phone: '01557994946' },
      variables: { customerName: 'طارق' },
      metadata: { invoiceId: 100 },
      context: { branchId: 3 },
    });

    expect(result).toEqual({
      sent: true,
      channel: 'whatsapp',
      messageId: 'wa-tpl-1',
    });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith({
      phone: '01557994946',
      message: renderTemplate(CUSTOMER_FIRST_TIME_DEFAULT_TEMPLATE, {
        customerName: 'طارق',
      }),
      metadata: {
        invoiceId: 100,
        templateKey: CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
        source: CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
      },
    });
    const body = sendWhatsAppMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('type');
    expect(Object.keys(body).sort()).toEqual(['message', 'metadata', 'phone']);
  });

  it('resolves branch override through sendTemplateMessage', async () => {
    lookupActiveMessageTemplate.mockResolvedValue({
      content: 'فرع خاص {{customerName}}',
      source: 'branch_db',
    });

    await sendTemplateMessage({
      templateKey: BOOKING_CONFIRMATION_TEMPLATE_KEY,
      recipient: { phone: '01557994946' },
      variables: {
        customerName: 'طارق',
        date: '2026-07-16',
        time: '14:00',
        service: 'حلاقة',
      },
      context: { branchId: 3 },
    });

    expect(lookupActiveMessageTemplate).toHaveBeenCalledWith({
      channel: 'whatsapp',
      templateKey: BOOKING_CONFIRMATION_TEMPLATE_KEY,
      language: 'ar',
      branchId: 3,
    });
    expect(sendWhatsAppMessage.mock.calls[0][0].message).toBe('فرع خاص طارق');
  });

  it('matches legacy first_time / booking / employee_sale production text', () => {
    expect(
      renderTemplate(CUSTOMER_FIRST_TIME_DEFAULT_TEMPLATE, { customerName: 'طارق' }),
    ).toBe(
      `أهلاً وسهلاً طارق! 🎉

نورتنا في Cut Salon لأول مرة وفرحانين إنك اخترتنا.

نتمنى تكون التجربة عجبتك، ولو عندك أي ملاحظة احنا دايمًا هنا.

منتظرينك تاني! 💈`,
    );

    expect(
      renderTemplate(BOOKING_CONFIRMATION_DEFAULT_TEMPLATE, {
        customerName: 'طارق',
        date: '2026-07-16',
        time: '14:00',
        service: 'حلاقة شعر',
        barberName: 'محمد',
      }),
    ).toBe(
      `أهلاً طارق،

تم تأكيد حجزك في Cut Salon بنجاح ✅

📅 الموعد: 2026-07-16
🕐 الساعة: 14:00
💇 الخدمة: حلاقة شعر
✂️ الحلاق: محمد

منتظرينك! 💈`,
    );

    expect(
      renderTemplate(BOOKING_CANCELLATION_DEFAULT_TEMPLATE, {
        customerName: 'صلاح محمد',
        date: '2026-08-30',
        time: '15:00',
        service: 'حلاقة شعر',
        bookingId: 'BK-V2URQ6',
        branchName: 'جليم – سابا باشا',
      }),
    ).toBe(
      `أهلاً صلاح محمد،

تم إلغاء حجزك في Cut Salon ❌

📅 الموعد: 2026-08-30
🕐 الساعة: 15:00
💇 الخدمة: حلاقة شعر
🔖 رقم الحجز: BK-V2URQ6
🏢 الفرع: جليم – سابا باشا

للاستفسار يرجى التواصل مع الفرع.`,
    );
    expect(BOOKING_CANCELLATION_DEFAULT_TEMPLATE).not.toContain('تم تأكيد حجزك');
    expect(BOOKING_CANCELLATION_DEFAULT_TEMPLATE).not.toContain('منتظرينك');
    expect(BOOKING_CANCELLATION_TEMPLATE_KEY).toBe('booking.cancellation');

    expect(
      renderTemplate(SALE_EMPLOYEE_NOTIFICATION_DEFAULT_TEMPLATE, {
        customerName: 'محمد',
        invoiceNumber: 'INV-10025',
        services: 'حلاقة شعر, تحديد دقن',
      }),
    ).toBe(
      [
        'تم تسجيل فاتورة جديدة لك محمد:',
        'رقم الفاتورة: INV-10025',
        'الخدمات: حلاقة شعر, تحديد دقن',
      ].join('\n'),
    );
  });
});

describe('Phase 6 production callers + feature contract', () => {
  it('migrates listed production callers to sendTemplateMessage', () => {
    const sales = src('src/app/api/sales/route.ts');
    expect(sales).toContain('sendTemplateMessage');
    expect(sales).not.toContain('sendFirstTimeWhatsAppMessage');
    expect(sales).not.toContain('sendEmployeeSaleWhatsAppMessage');

    const booking = src('src/lib/bookingPostCommitNotification.ts');
    expect(booking).toContain('sendTemplateMessage');
    expect(booking).toContain('BOOKING_CONFIRMATION_TEMPLATE_KEY');
    expect(booking).toContain('BOOKING_CANCELLATION_TEMPLATE_KEY');
    expect(booking).not.toContain('sendBookingWhatsAppMessage');

    const advance = src('src/lib/services/employeeAdvanceWhatsAppNotify.ts');
    expect(advance).toContain('sendTemplateMessage');
    expect(advance).not.toContain('sendEmployeeAdvanceWhatsAppMessage');
    expect(advance).not.toContain('sendEmployeeFundingWhatsAppMessage');
    expect(advance).toContain('EMPLOYEE_TIP_TEMPLATE_KEY');
    expect(advance).not.toContain('sendOtherWhatsAppMessage');

    const attendance = src('src/lib/services/employeeAttendanceWhatsAppNotify.ts');
    expect(attendance).toContain('sendTemplateMessage');
    expect(attendance).not.toContain('sendOtherWhatsAppMessage');

    const empDaily = src('src/lib/hr/employee-daily-whatsapp-report.service.ts');
    expect(empDaily).toContain('sendTemplateMessage');
    expect(empDaily).not.toContain('sendEmployeeDailyReportWhatsAppMessage');

    const owner = src('src/lib/hr/owner-daily-whatsapp-report.service.ts');
    expect(owner).toContain('sendTemplateMessage');
    expect(owner).not.toContain('sendQuickWhatsAppMessage');
  });

  it('keeps Quick Message as free text and sale receipt on messaging module', () => {
    const quick = src('src/app/api/pos/whatsapp/quick-send/route.ts');
    expect(quick).toContain('sendMessage');
    expect(quick).not.toContain('composeMessage');
    expect(quick).not.toContain('sendTemplateMessage');

    const sale = src('src/modules/messaging/application/sendSaleCustomerReceipt.ts');
    expect(sale).toContain('sendTemplateMessage');
    expect(sale).toContain('SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY');
  });

  it('lists all templates from definitions (Admin auto-discovery)', () => {
    const keys = listWhatsAppTemplateDefinitions().map((d) => d.templateKey);
    expect(keys).toEqual([
      'sale.customer_receipt',
      'customer.first_time',
      'sale.employee_notification',
      'booking.confirmation',
      'booking.cancellation',
      'employee.advance',
      'employee.funding',
      'attendance.check_in',
      'attendance.check_out',
      'employee.daily_report',
      'owner.daily_report',
      'employee.tip',
    ]);
  });

  it('does not require Gateway/Bot changes to add a new template definition', () => {
    const catalog = src('src/modules/messaging/templates/catalog.ts');
    const defs = src('src/modules/messaging/templates/definitions.ts');
    const sendTpl = src('src/modules/messaging/application/sendTemplateMessage.ts');
    expect(catalog).toContain('CODE_DEFAULT_TEMPLATES');
    expect(defs).toContain('WHATSAPP_TEMPLATE_DEFINITIONS');
    expect(sendTpl).toContain('composeMessage');
    expect(sendTpl).toContain('sendMessage');
    expect(sendTpl).toContain('mergeMetadata');

    const adapter = src('src/modules/messaging/infra/whatsappAdapter.ts');
    expect(adapter).toContain('sendWhatsAppMessage');
    expect(adapter).not.toContain('type:');
  });
});
