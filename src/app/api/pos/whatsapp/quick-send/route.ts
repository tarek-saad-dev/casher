import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  sendQuickWhatsAppMessage,
  getWhatsAppConfig,
} from '@/lib/integrations/whatsapp';

export const runtime = 'nodejs';

/**
 * POST /api/pos/whatsapp/quick-send
 * Body: { phone: string, customerName?: string, message?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = (await req.json()) as {
      phone?: string;
      customerName?: string;
      message?: string;
    };

    const phone = String(body.phone ?? '').trim();
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      return NextResponse.json({ error: 'أدخل رقم واتساب صحيح' }, { status: 400 });
    }

    const cfg = getWhatsAppConfig();
    const message = String(body.message ?? cfg.defaultQuickMessage).trim();
    if (!message) {
      return NextResponse.json({ error: 'الرسالة فارغة' }, { status: 400 });
    }

    const result = await sendQuickWhatsAppMessage({
      phone,
      customerName: body.customerName?.trim() || 'عميل',
      message,
    });

    if (result.sent) {
      return NextResponse.json({ ok: true, result });
    }

    if (result.skipped) {
      const messages: Record<string, string> = {
        development_only: 'تكامل واتساب غير مفعّل حالياً',
        disabled: 'تكامل واتساب غير مفعّل حالياً',
        message_type_disabled: 'إرسال الرسالة السريعة معطّل',
        missing_phone: 'أدخل رقم واتساب صحيح',
        missing_customer_name: 'اسم العميل مطلوب',
        invalid_payload: 'بيانات الرسالة غير صالحة',
      };
      return NextResponse.json(
        {
          ok: false,
          error: messages[result.reason] ?? 'تم تخطي الإرسال',
          result,
        },
        { status: 400 },
      );
    }

    const failMessages: Record<string, string> = {
      invalid_phone: 'رقم الواتساب غير صالح',
      whatsapp_not_ready: 'واتساب غير جاهز — تأكد أن سكربت الواتساب يعمل',
      timeout: 'انتهت مهلة الاتصال بسكربت الواتساب',
      connection_failed: 'فشل الاتصال بسكربت الواتساب — هل التطبيق شغال؟',
      remote_error: 'خطأ من سكربت الواتساب',
      invalid_response: 'رد غير صالح من سكربت الواتساب',
    };

    return NextResponse.json(
      {
        ok: false,
        error:
          ('error' in result && result.error) ||
          failMessages[result.reason] ||
          'فشل إرسال الرسالة',
        result,
      },
      { status: 502 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/whatsapp/quick-send]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
