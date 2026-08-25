import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendWhatsAppMessage = vi.fn();

vi.mock('@/lib/integrations/whatsapp', () => ({
  sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessage(...args),
}));

import { sendMessage } from '@/modules/messaging';
import type { SendMessageInput } from '@/modules/messaging';

describe('messaging sendMessage (WhatsApp)', () => {
  beforeEach(() => {
    sendWhatsAppMessage.mockReset();
  });

  it('uses generic sendWhatsAppMessage with phone/text/metadata and no type', async () => {
    sendWhatsAppMessage.mockResolvedValue({
      sent: true,
      skipped: false,
      status: 'sent',
      messageId: 'wa-msg-1',
    });

    const metadata = { source: 'pos.quick_message', ticketId: 9 };
    const result = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone: '01557994946' },
      content: { text: 'أهلا بك في Cut Salon' },
      metadata,
    });

    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith({
      phone: '01557994946',
      message: 'أهلا بك في Cut Salon',
      metadata,
    });
    const sentBody = sendWhatsAppMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty('type');
    expect(result).toEqual({
      sent: true,
      channel: 'whatsapp',
      messageId: 'wa-msg-1',
    });
  });

  it('maps a successful generic send to MessageSendResult', async () => {
    sendWhatsAppMessage.mockResolvedValue({
      sent: true,
      skipped: false,
      status: 'sent',
      messageId: 'wa-ok',
      sentAt: '2026-08-25T01:00:00.000Z',
    });

    const result = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone: '01557994946' },
      content: { text: 'hello' },
    });

    expect(result.sent).toBe(true);
    if (result.sent) {
      expect(result.channel).toBe('whatsapp');
      expect(result.messageId).toBe('wa-ok');
    }
  });

  it('does not treat disabled/failure as success', async () => {
    sendWhatsAppMessage.mockResolvedValue({
      sent: false,
      skipped: true,
      reason: 'development_only',
    });

    const disabled = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone: '01557994946' },
      content: { text: 'hello' },
    });

    expect(disabled).toEqual({
      sent: false,
      channel: 'whatsapp',
      reason: 'development_only',
      skipped: true,
    });

    sendWhatsAppMessage.mockResolvedValue({
      sent: false,
      skipped: false,
      reason: 'timeout',
    });

    const timedOut = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone: '01557994946' },
      content: { text: 'hello' },
    });

    expect(timedOut.sent).toBe(false);
    if (!timedOut.sent) {
      expect(timedOut.reason).toBe('timeout');
      expect(timedOut.skipped).toBe(false);
    }
  });

  it('rejects an unsupported channel without calling WhatsApp', async () => {
    const result = await sendMessage({
      channel: 'sms' as SendMessageInput['channel'],
      recipient: { phone: '01557994946' },
      content: { text: 'hello' },
    });

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      sent: false,
      channel: 'sms',
      reason: 'unsupported_channel',
      skipped: true,
    });
  });

  it('skips empty phone/text without calling WhatsApp', async () => {
    const missingPhone = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone: '   ' },
      content: { text: 'hello' },
    });
    expect(missingPhone).toMatchObject({
      sent: false,
      reason: 'missing_phone',
      skipped: true,
    });

    const emptyText = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone: '01557994946' },
      content: { text: '' },
    });
    expect(emptyText).toMatchObject({
      sent: false,
      reason: 'invalid_payload',
      skipped: true,
    });

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });
});
