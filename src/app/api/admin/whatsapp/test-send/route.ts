import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import {
  sendSaleWhatsAppMessage,
  sendBookingWhatsAppMessage,
  sendFirstTimeWhatsAppMessage,
  sendEmployeeSaleWhatsAppMessage,
  sendEmployeeAdvanceWhatsAppMessage,
  sendEmployeeDailyReportWhatsAppMessage,
} from '@/lib/integrations/whatsapp';

export const runtime = 'nodejs';

/**
 * POST /api/admin/whatsapp/test-send
 * Development-only manual test endpoint.
 */
export async function POST(req: NextRequest) {
  const auth = await requireDevelopmentAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const { type, phone, customerName } = body as {
      type: string;
      phone: string;
      customerName: string;
    };

    if (!type || !phone || !customerName) {
      return NextResponse.json({ error: 'type, phone, customerName are required' }, { status: 400 });
    }

    let result;

    if (type === 'sale') {
      result = await sendSaleWhatsAppMessage({
        phone,
        customerName,
        invID: 9999,
        total: 0,
        paymentMethod: 'كاش',
        services: ['اختبار'],
      });
    } else if (type === 'booking') {
      const today = new Date().toISOString().split('T')[0];
      result = await sendBookingWhatsAppMessage({
        phone,
        customerName,
        bookingDate: today,
        bookingTime: '12:00',
        services: ['اختبار'],
      });
    } else if (type === 'first_time') {
      result = await sendFirstTimeWhatsAppMessage({ phone, customerName });
    } else if (type === 'employee_sale') {
      result = await sendEmployeeSaleWhatsAppMessage({
        phone,
        employeeName: customerName,
        invID: 9999,
        services: ['حلاقة', 'تحديد دقن'],
      });
    } else if (type === 'employee_advance') {
      result = await sendEmployeeAdvanceWhatsAppMessage({
        phone,
        employeeName: customerName,
        invID: 9999,
        amount: 500,
        paymentMethod: 'كاش',
        notes: 'اختبار سلفة',
      });
    } else if (type === 'employee_daily_report') {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
      result = await sendEmployeeDailyReportWhatsAppMessage({
        phone,
        employeeName: customerName,
        workDate: today,
        ledgerBalance: 1850,
        message: `🌙 تقرير يومك — جليم\nاختبار employee_daily_report\nيا ${customerName}\n\n📒 رصيد حسابك حتى الآن: 1,850.00 ج.م`,
      });
    } else {
      return NextResponse.json({
        error:
          'type must be sale | booking | first_time | employee_sale | employee_advance | employee_daily_report',
      }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
