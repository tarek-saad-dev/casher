import { NextRequest, NextResponse } from 'next/server';
import {
  sendSaleWhatsAppMessage,
  sendBookingWhatsAppMessage,
  sendFirstTimeWhatsAppMessage,
} from '@/lib/integrations/whatsapp';

export const runtime = 'nodejs';

/**
 * POST /api/admin/whatsapp/test-send
 * Development-only manual test endpoint.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'Available in development mode only' },
      { status: 403 },
    );
  }

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
    } else {
      return NextResponse.json({ error: 'type must be sale | booking | first_time' }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
