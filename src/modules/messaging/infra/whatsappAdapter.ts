import { sendWhatsAppMessage } from '@/lib/integrations/whatsapp';
import type { MessageContent, MessageRecipient, MessageSendResult } from '../domain/types';

export async function sendWhatsAppChannelMessage(input: {
  recipient: MessageRecipient;
  content: MessageContent;
  metadata?: Record<string, unknown>;
}): Promise<MessageSendResult> {
  try {
    const result = await sendWhatsAppMessage({
      phone: input.recipient.phone,
      message: input.content.text,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    });

    if (result.sent) {
      return {
        sent: true,
        channel: 'whatsapp',
        messageId: result.messageId,
      };
    }

    return {
      sent: false,
      channel: 'whatsapp',
      reason: result.reason,
      skipped: result.skipped,
      ...('error' in result && result.error ? { error: result.error } : {}),
    };
  } catch (err) {
    return {
      sent: false,
      channel: 'whatsapp',
      reason: 'remote_error',
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
