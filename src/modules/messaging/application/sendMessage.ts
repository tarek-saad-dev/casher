import type { MessageSendResult, SendMessageInput } from '../domain/types';
import { sendWhatsAppChannelMessage } from '../infra/whatsappAdapter';

function isWhatsAppChannel(channel: string): channel is 'whatsapp' {
  return channel === 'whatsapp';
}

/**
 * Application entry for outbound messages.
 * Features should call this instead of WhatsApp integration senders.
 */
export async function sendMessage(input: SendMessageInput): Promise<MessageSendResult> {
  const channel = String(input.channel ?? '');
  if (!isWhatsAppChannel(channel)) {
    return {
      sent: false,
      channel: channel || 'unknown',
      reason: 'unsupported_channel',
      skipped: true,
    };
  }

  const phone = input.recipient?.phone;
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    return {
      sent: false,
      channel: 'whatsapp',
      reason: 'missing_phone',
      skipped: true,
    };
  }

  const text = input.content?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return {
      sent: false,
      channel: 'whatsapp',
      reason: 'invalid_payload',
      skipped: true,
    };
  }

  return sendWhatsAppChannelMessage({
    recipient: { phone },
    content: { text },
    metadata: input.metadata,
  });
}
