/**
 * Parity with whatsapp-bot sale rendering (read-only review of bot DEFAULT_TEMPLATES.sale
 * and templateRenderer.js). Do not change bot text.
 */
import { describe, it, expect } from 'vitest';
import { composeMessage } from '@/modules/messaging/application/composeMessage';
import { renderTemplate, ARABIC_COMMA } from '@/modules/messaging/templates/renderTemplate';
import { SALE_CUSTOMER_RECEIPT_DEFAULT_TEMPLATE } from '@/modules/messaging/templates/defaults/saleCustomerReceipt';
import { buildSaleCustomerReceiptData } from '@/modules/messaging/application/sendSaleCustomerReceipt';

const noDb = { lookupActiveTemplate: async () => null };

/** Bot API test fixture template (whatsapp-bot/tests/api/whatsapp.test.js). */
const BOT_RICH_SALE_TEMPLATE =
  'أهلاً يا {{customerName}} 👋\n\nرقم الفاتورة: {{invoiceNumber}}\nالخدمات: {{services}}\nالإجمالي: {{total}} {{currency}}\nطريقة الدفع: {{paymentMethod}}\nالفرع: {{branchName}}\nمقدم الخدمة: {{employeeName}}\n\nنتمنى نشوفك قريباً 🤍';

const FULL_SALE = {
  phone: '01557994946',
  customerName: 'طارق',
  invoiceId: 10025,
  total: 350,
  paymentMethod: 'كاش',
  services: ['حلاقة شعر', 'تحديد دقن'],
  employeeNames: ['محمد'],
  branchName: 'جليم',
};

describe('sale.customer_receipt default template parity', () => {
  it('matches the bot default sale body for a normal invoice', async () => {
    const { text } = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: buildSaleCustomerReceiptData(FULL_SALE),
      },
      noDb,
    );
    expect(text).toBe(`أستاذ طارق
نورت Cut Salon ودايمًا منورنا 🙏✨`);
    expect(text).toBe(
      renderTemplate(SALE_CUSTOMER_RECEIPT_DEFAULT_TEMPLATE, {
        customerName: 'طارق',
      }),
    );
  });

  it('does not change text when multiple services/employees are present (default template has no those lines)', async () => {
    const multi = (
      await composeMessage(
        {
          templateKey: 'sale.customer_receipt',
          variables: buildSaleCustomerReceiptData({
            ...FULL_SALE,
            services: ['حلاقة شعر', 'تحديد دقن', 'صبغة'],
            employeeNames: ['محمد', 'كريم'],
          }),
        },
        noDb,
      )
    ).text;
    const single = (
      await composeMessage(
        {
          templateKey: 'sale.customer_receipt',
          variables: buildSaleCustomerReceiptData(FULL_SALE),
        },
        noDb,
      )
    ).text;
    expect(multi).toBe(single);
    expect(multi).not.toContain('حلاقة');
    expect(multi).not.toContain('محمد');
  });

  it('does not surface discount or payment on the default template (legacy default has neither)', async () => {
    const discounted = (
      await composeMessage(
        {
          templateKey: 'sale.customer_receipt',
          variables: buildSaleCustomerReceiptData({
            ...FULL_SALE,
            total: 250,
            paymentMethod: 'كاش + فيزا',
          }),
        },
        noDb,
      )
    ).text;
    expect(discounted).toBe(`أستاذ طارق
نورت Cut Salon ودايمًا منورنا 🙏✨`);
    expect(discounted).not.toContain('250');
    expect(discounted).not.toContain('كاش');
    expect(discounted).not.toContain('خصم');
  });

  it('renders the fallback customer name the POS uses when Name is empty', async () => {
    const { text } = await composeMessage(
      {
        templateKey: 'sale.customer_receipt',
        variables: buildSaleCustomerReceiptData({
          ...FULL_SALE,
          customerName: 'عميل',
        }),
      },
      noDb,
    );
    expect(text).toBe(`أستاذ عميل
نورت Cut Salon ودايمًا منورنا 🙏✨`);
  });

  it('rejects missing customerName like the bot renderer', async () => {
    await expect(
      composeMessage(
        {
          templateKey: 'sale.customer_receipt',
          variables: { customerName: '' },
        },
        noDb,
      ),
    ).rejects.toThrow('customerName is required');
  });
});

describe('legacy bot renderer parity (rich sale template)', () => {
  it('joins services with an Arabic comma and keeps optional lines that have values', () => {
    const text = renderTemplate(BOT_RICH_SALE_TEMPLATE, {
      customerName: 'طارق',
      invoiceNumber: 'INV-10025',
      services: ['حلاقة شعر', 'تحديد دقن'],
      total: 350,
      currency: 'ج.م',
      paymentMethod: 'كاش',
      branchName: 'جليم',
      employeeName: 'محمد',
    });
    expect(text).toBe(
      [
        'أهلاً يا طارق 👋',
        '',
        'رقم الفاتورة: INV-10025',
        `الخدمات: حلاقة شعر${ARABIC_COMMA} تحديد دقن`,
        'الإجمالي: 350 ج.م',
        'طريقة الدفع: كاش',
        'الفرع: جليم',
        'مقدم الخدمة: محمد',
        '',
        'نتمنى نشوفك قريباً 🤍',
      ].join('\n'),
    );
  });

  it('omits optional sale lines when values are missing (bot test: omits optional sale lines)', () => {
    const text = renderTemplate(BOT_RICH_SALE_TEMPLATE, {
      customerName: 'طارق',
    });
    expect(text).toContain('طارق');
    expect(text).not.toContain('رقم الفاتورة');
    expect(text).not.toContain('طريقة الدفع');
    expect(text).not.toContain('الإجمالي');
    expect(text).not.toContain('الخدمات');
    expect(text).not.toContain('الفرع');
  });

  it('drops the total line when currency is missing even if total is set (same line as bot)', () => {
    const text = renderTemplate(BOT_RICH_SALE_TEMPLATE, {
      customerName: 'طارق',
      invoiceNumber: 'INV-1',
      total: 250,
      paymentMethod: 'كاش',
    });
    expect(text).toContain('رقم الفاتورة: INV-1');
    expect(text).toContain('طريقة الدفع: كاش');
    expect(text).not.toContain('الإجمالي');
    expect(text).not.toContain('250');
  });

  it('joins unique employee names with " / " like the legacy POS payload builder', () => {
    const data = buildSaleCustomerReceiptData({
      ...FULL_SALE,
      employeeNames: ['محمد', 'محمد', 'كريم'],
    });
    expect(data.employeeName).toBe('محمد / كريم');
  });
});
