import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import {
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
  CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
  EMPLOYEE_ADVANCE_TEMPLATE_KEY,
  EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY,
  SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,
  SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
  sendMessage,
  sendTemplateMessage,
} from '@/modules/messaging';

export const runtime = 'nodejs';

const TEMPLATE_TYPES = [
  'sale',
  'booking',
  'first_time',
  'employee_sale',
  'employee_advance',
  'employee_daily_report',
] as const;

type TestSendType = (typeof TEMPLATE_TYPES)[number] | 'free_text';

/**
 * POST /api/admin/whatsapp/test-send
 * Development-only. Sends via Messaging Module → Generic Gateway (no typed bot APIs).
 *
 * Body:
 * - mode/type: free_text | sale | booking | first_time | employee_sale | employee_advance | employee_daily_report
 * - phone, customerName required
 * - message required when free_text
 */
export async function POST(req: NextRequest) {
  const auth = await requireDevelopmentAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const type = String((body as { type?: string; mode?: string }).type
      ?? (body as { mode?: string }).mode
      ?? '').trim() as TestSendType;
    const phone = String((body as { phone?: string }).phone ?? '').trim();
    const customerName = String((body as { customerName?: string }).customerName ?? '').trim();
    const freeText = String((body as { message?: string }).message ?? '').trim();

    if (!type || !phone || !customerName) {
      return NextResponse.json(
        { error: 'type, phone, customerName are required' },
        { status: 400 },
      );
    }

    if (type === 'free_text') {
      if (!freeText) {
        return NextResponse.json({ error: 'message is required for free_text' }, { status: 400 });
      }
      const result = await sendMessage({
        channel: 'whatsapp',
        recipient: { phone },
        content: { text: freeText },
        metadata: {
          source: 'admin.test_send',
          mode: 'free_text',
        },
      });
      return NextResponse.json({ result });
    }

    if (!(TEMPLATE_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        {
          error:
            'type must be free_text | sale | booking | first_time | employee_sale | employee_advance | employee_daily_report',
        },
        { status: 400 },
      );
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    let templateKey: string;
    let variables: Record<string, unknown>;

    switch (type) {
      case 'sale':
        templateKey = SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY;
        variables = {
          customerName,
          invoiceNumber: 'INV-9999',
          total: 0,
          paymentMethod: 'كاش',
          services: ['اختبار'],
          branchName: 'جليم',
          employeeName: customerName,
        };
        break;
      case 'booking':
        templateKey = BOOKING_CONFIRMATION_TEMPLATE_KEY;
        variables = {
          customerName,
          date: today,
          time: '12:00',
          service: 'اختبار',
          bookingDate: today,
          bookingTime: '12:00',
          services: ['اختبار'],
          barberName: 'محمد',
        };
        break;
      case 'first_time':
        templateKey = CUSTOMER_FIRST_TIME_TEMPLATE_KEY;
        variables = { customerName };
        break;
      case 'employee_sale':
        templateKey = SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY;
        variables = {
          customerName,
          employeeName: customerName,
          invoiceNumber: 'INV-9999',
          services: 'حلاقة, تحديد دقن',
        };
        break;
      case 'employee_advance':
        templateKey = EMPLOYEE_ADVANCE_TEMPLATE_KEY;
        variables = {
          customerName,
          amount: 500,
          invoiceNumber: 'ADV-9999',
          paymentMethod: 'كاش',
          branchName: 'جليم',
          notes: 'اختبار سلفة',
        };
        break;
      case 'employee_daily_report':
        templateKey = EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY;
        variables = {
          customerName,
          message: `🌙 تقرير يومك — جليم\nاختبار employee_daily_report\nيا ${customerName}\n\n📒 رصيد حسابك حتى الآن: 1,850.00 ج.م`,
          workDate: today,
          branchName: 'جليم',
        };
        break;
      default:
        return NextResponse.json({ error: 'unsupported type' }, { status: 400 });
    }

    const result = await sendTemplateMessage({
      templateKey,
      recipient: { phone },
      variables,
      metadata: {
        source: 'admin.test_send',
        mode: type,
      },
      context: { language: 'ar' },
    });

    return NextResponse.json({ result });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
