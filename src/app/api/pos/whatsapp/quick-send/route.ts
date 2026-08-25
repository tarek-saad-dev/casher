import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getWhatsAppConfig } from '@/lib/integrations/whatsapp';
import { sendMessage } from '@/modules/messaging';

export const runtime = 'nodejs';

const SKIPPED_MESSAGES: Record<string, string> = {
  development_only: 'تكامل واتساب غير مفعّل حالياً',
  disabled: 'تكامل واتساب غير مفعّل حالياً',
  message_type_disabled: 'إرسال الرسالة السريعة معطّل',
  missing_phone: 'أدخل رقم واتساب صحيح',
  missing_customer_name: 'اسم العميل مطلوب',
  invalid_payload: 'بيانات الرسالة غير صالحة',
};

const FAIL_MESSAGES: Record<string, string> = {
  invalid_phone: 'رقم الواتساب غير صالح',
  whatsapp_not_ready: 'واتساب غير جاهز — تأكد أن سكربت الواتساب يعمل',
  timeout: 'انتهت مهلة الاتصال بسكربت الواتساب',
  connection_failed: 'فشل الاتصال بسكربت الواتساب — هل التطبيق شغال؟',
  remote_error: 'خطأ من سكربت الواتساب',
  invalid_response: 'رد غير صالح من سكربت الواتساب',
};

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

    if (!cfg.quickMessageEnabled) {
      return NextResponse.json(
        {
          ok: false,
          error: SKIPPED_MESSAGES.message_type_disabled,
          result: { sent: false, skipped: true, reason: 'message_type_disabled' },
        },
        { status: 400 },
      );
    }

    const metadata: Record<string, unknown> = {
      source: 'pos.quick_message',
    };
    if (typeof session.ActiveBranchID === 'number') {
      metadata.branchId = session.ActiveBranchID;
    }
    if (typeof session.UserID === 'number') {
      metadata.userId = session.UserID;
    }

    const result = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone },
      content: { text: message },
      metadata,
    });

    if (result.sent) {
      return NextResponse.json({
        ok: true,
        result: {
          sent: true,
          skipped: false,
          status: 'sent',
          messageId: result.messageId,
        },
      });
    }

    if (result.skipped) {
      return NextResponse.json(
        {
          ok: false,
          error: SKIPPED_MESSAGES[result.reason] ?? 'تم تخطي الإرسال',
          result: {
            sent: false,
            skipped: true,
            reason: result.reason,
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: result.error || FAIL_MESSAGES[result.reason] || 'فشل إرسال الرسالة',
        result: {
          sent: false,
          skipped: false,
          reason: result.reason,
        },
      },
      { status: 502 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/whatsapp/quick-send]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
