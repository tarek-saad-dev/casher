import { getWhatsAppConfig } from '@/lib/integrations/whatsapp';
import type { WhatsAppConfig } from '@/lib/integrations/whatsapp/config';
import type { MessageSendResult } from '../domain/types';
import { MessageTemplateError } from '../domain/templateTypes';
import { composeMessage } from './composeMessage';
import { sendMessage } from './sendMessage';
import {
  ATTENDANCE_CHECK_IN_TEMPLATE_KEY,
  ATTENDANCE_CHECK_OUT_TEMPLATE_KEY,
  BOOKING_CANCELLATION_TEMPLATE_KEY,
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
  CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
  EMPLOYEE_ADVANCE_TEMPLATE_KEY,
  EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY,
  EMPLOYEE_FUNDING_TEMPLATE_KEY,
  OWNER_DAILY_REPORT_TEMPLATE_KEY,
  SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,
  SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
  EMPLOYEE_TIP_TEMPLATE_KEY,
} from '../templates/catalog';

export type SendTemplateMessageRecipient = {
  phone: string;
};

export type SendTemplateMessageContext = {
  branchId?: number;
  userId?: number | string;
  language?: 'ar' | 'en';
};

export type SendTemplateMessageInput = {
  templateKey: string;
  recipient: SendTemplateMessageRecipient;
  variables: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  context?: SendTemplateMessageContext;
};

export type SendTemplateMessageDeps = {
  /**
   * Delivery adapter. Defaults to direct sendMessage.
   * Later this can point at enqueueMessage without changing feature callers.
   */
  send?: typeof sendMessage;
  compose?: typeof composeMessage;
};

function isKnownTemplateEnabled(templateKey: string, cfg: WhatsAppConfig): boolean | null {
  switch (templateKey) {
    case SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY:
      return cfg.saleEnabled;
    case CUSTOMER_FIRST_TIME_TEMPLATE_KEY:
      return cfg.firstTimeEnabled;
    case SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY:
      return cfg.employeeSaleEnabled;
    case BOOKING_CONFIRMATION_TEMPLATE_KEY:
    case BOOKING_CANCELLATION_TEMPLATE_KEY:
      return cfg.bookingEnabled;
    case EMPLOYEE_ADVANCE_TEMPLATE_KEY:
      return cfg.employeeAdvanceEnabled;
    case EMPLOYEE_FUNDING_TEMPLATE_KEY:
      return cfg.employeeFundingEnabled;
    case ATTENDANCE_CHECK_IN_TEMPLATE_KEY:
    case ATTENDANCE_CHECK_OUT_TEMPLATE_KEY:
      return cfg.otherEnabled;
    case EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY:
      return cfg.employeeDailyReportEnabled;
    case OWNER_DAILY_REPORT_TEMPLATE_KEY:
      return cfg.ownerDailyReportEnabled;
    case EMPLOYEE_TIP_TEMPLATE_KEY:
      return cfg.otherEnabled;
    default:
      return null;
  }
}

function mergeMetadata(
  templateKey: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(extra ?? {}),
    templateKey,
    source: templateKey,
  };
}

/**
 * Public feature integration boundary for templated WhatsApp.
 *
 * Internally: templateKey → composeMessage (branch/global/default + render)
 * → sendMessage → generic sendWhatsAppMessage → Gateway.
 *
 * Features must not call composeMessage+sendMessage, sendWhatsAppMessage,
 * the HTTP client, or typed bot APIs.
 */
export async function sendTemplateMessage(
  input: SendTemplateMessageInput,
  deps?: SendTemplateMessageDeps,
): Promise<MessageSendResult> {
  const templateKey = String(input.templateKey ?? '').trim();
  const cfg = getWhatsAppConfig();

  if (!cfg.enabled) {
    console.log(
      '[whatsapp] Integration skipped: WHATSAPP_INTEGRATION_ENABLED is not true',
    );
    return { sent: false, channel: 'whatsapp', reason: 'development_only', skipped: true };
  }

  if (!templateKey) {
    return { sent: false, channel: 'whatsapp', reason: 'invalid_payload', skipped: true };
  }

  const featureEnabled = isKnownTemplateEnabled(templateKey, cfg);
  if (featureEnabled === false) {
    console.log(`[whatsapp] Template ${templateKey} skipped: type disabled`);
    return { sent: false, channel: 'whatsapp', reason: 'message_type_disabled', skipped: true };
  }

  const phone = typeof input.recipient?.phone === 'string' ? input.recipient.phone.trim() : '';
  if (!phone) {
    console.log(`[whatsapp] Template ${templateKey} skipped: missing phone`);
    return { sent: false, channel: 'whatsapp', reason: 'missing_phone', skipped: true };
  }

  const compose = deps?.compose ?? composeMessage;
  const send = deps?.send ?? sendMessage;

  let text: string;
  try {
    const composed = await compose({
      templateKey,
      variables: input.variables ?? {},
      context: {
        channel: 'whatsapp',
        language: input.context?.language ?? 'ar',
        ...(typeof input.context?.branchId === 'number'
          ? { branchId: input.context.branchId }
          : {}),
      },
    });
    text = composed.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[whatsapp] Template ${templateKey} skipped: validation — ${message}`);
    if (err instanceof MessageTemplateError && err.code === 'UNKNOWN_TEMPLATE') {
      return { sent: false, channel: 'whatsapp', reason: 'invalid_payload', skipped: true };
    }
    if (message.includes('customerName is required')) {
      return { sent: false, channel: 'whatsapp', reason: 'missing_customer_name', skipped: true };
    }
    return { sent: false, channel: 'whatsapp', reason: 'invalid_payload', skipped: true };
  }

  return send({
    channel: 'whatsapp',
    recipient: { phone },
    content: { text },
    metadata: mergeMetadata(templateKey, input.metadata),
  });
}
