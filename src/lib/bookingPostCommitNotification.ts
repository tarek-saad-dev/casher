/**
 * Schedule booking WhatsApp after HTTP response (never before commit; never blocks 201).
 */
import {
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
  sendTemplateMessage,
  type MessageSendResult,
} from '@/modules/messaging';
import { getWhatsAppConfig } from '@/lib/integrations/whatsapp';
import {
  POST_RESPONSE_MECHANISM,
  schedulePostResponse,
} from '@/lib/schedulePostResponse';

export const BOOKING_WHATSAPP_EXECUTION = POST_RESPONSE_MECHANISM;

export type BookingWhatsAppScheduleInput = {
  phone: string;
  customerName: string;
  bookingId: number;
  bookingDate: string;
  bookingTime: string;
  barberName?: string;
  services?: string[];
  branchName?: string;
  branchId?: number;
};

export type BookingWhatsAppSendOutcome = {
  ok: boolean;
  providerMessageId?: string | null;
  error?: string | null;
};

export type BookingWhatsAppSendFn = (
  input: BookingWhatsAppScheduleInput,
) => Promise<MessageSendResult | { sent: boolean; skipped?: boolean; reason?: string; messageId?: string }>;

/** Mask phone for logs — never log full PII. */
export function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 3)}****${digits.slice(-2)}`;
}

async function sendBookingConfirmationTemplate(
  input: BookingWhatsAppScheduleInput,
): Promise<MessageSendResult> {
  const cfg = getWhatsAppConfig();
  return sendTemplateMessage({
    templateKey: BOOKING_CONFIRMATION_TEMPLATE_KEY,
    recipient: { phone: input.phone },
    variables: {
      customerName: input.customerName,
      bookingDate: input.bookingDate,
      bookingTime: input.bookingTime,
      date: input.bookingDate,
      time: input.bookingTime,
      services: input.services,
      service: input.services,
      barberName: input.barberName,
      branchName: input.branchName ?? cfg.defaultBranchName,
      bookingId: `BK-${input.bookingId}`,
      bookingLink: cfg.defaultBookingLink,
    },
    metadata: {
      bookingId: input.bookingId,
      ...(typeof input.branchId === 'number' ? { branchId: input.branchId } : {}),
    },
    context: {
      language: 'ar',
      ...(typeof input.branchId === 'number' ? { branchId: input.branchId } : {}),
    },
  });
}

/**
 * Schedules WhatsApp exactly once via post-response `after()`.
 * Call only after a successful transaction commit.
 * Optional onResult updates idempotency status (sent/failed) after provider response.
 */
export function scheduleBookingWhatsAppAfterCommit(
  input: BookingWhatsAppScheduleInput,
  deps?: {
    schedule?: typeof schedulePostResponse;
    send?: BookingWhatsAppSendFn;
    onResult?: (result: BookingWhatsAppSendOutcome) => void | Promise<void>;
  },
): { scheduled: true; mechanism: typeof BOOKING_WHATSAPP_EXECUTION } {
  const schedule = deps?.schedule ?? schedulePostResponse;
  const send = deps?.send ?? sendBookingConfirmationTemplate;
  const onResult = deps?.onResult;

  schedule(async () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[booking/create] WhatsApp started', {
        bookingId: input.bookingId,
        phone: maskPhoneForLog(input.phone),
      });
    }
    const t0 = Date.now();
    try {
      const result = await send(input);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[booking/create] WhatsApp completed', {
          bookingId: input.bookingId,
          durationMs: Date.now() - t0,
          sent: result.sent,
        });
      }
      if (onResult) {
        const providerMessageId =
          'messageId' in result && result.messageId != null
            ? String(result.messageId)
            : null;
        await onResult({
          ok: Boolean(result.sent),
          providerMessageId,
          error: result.sent
            ? null
            : ('reason' in result ? result.reason : null) ?? 'send_failed',
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown_error';
      console.log('[booking/create] WhatsApp error (non-critical)', {
        bookingId: input.bookingId,
        phone: maskPhoneForLog(input.phone),
        error,
      });
      if (onResult) {
        await onResult({ ok: false, error });
      }
    }
  });

  return { scheduled: true, mechanism: BOOKING_WHATSAPP_EXECUTION };
}
