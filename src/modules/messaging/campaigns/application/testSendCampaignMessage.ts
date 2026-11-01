import { enqueueMessage } from '../../application/enqueueMessage';
import { normalizePhoneDigits, isValidCampaignPhone } from '../audience/normalizePhone';
import { CampaignError, WHATSAPP_CAMPAIGN_TEMPLATE_KEY } from '../domain/types';
import { renderCampaignMessageForRecipient } from './renderCampaignMessage';

function parseAllowedTestPhones(): Set<string> {
  const raw = String(process.env.WHATSAPP_CAMPAIGN_TEST_PHONES || '').trim();
  const set = new Set<string>();
  if (!raw) return set;
  for (const part of raw.split(/[,;\s]+/)) {
    const d = normalizePhoneDigits(part);
    if (d) set.add(d);
  }
  return set;
}

/**
 * Enqueue a single test message to an authorized admin/test phone.
 * Does not create a customer campaign. Uses outbox (official channel path).
 */
export async function testSendCampaignMessage(input: {
  phone: string;
  messageMode: 'template' | 'custom';
  templateKey?: string | null;
  customMessage?: string | null;
  sampleName?: string;
  sampleBranchName?: string | null;
  branchId?: number | null;
  userId: number;
}): Promise<{ messageId: number; duplicate: boolean }> {
  const phone = String(input.phone ?? '').trim();
  if (!isValidCampaignPhone(phone)) {
    throw new CampaignError('رقم الاختبار غير صالح', 'INVALID_INPUT');
  }

  const allowed = parseAllowedTestPhones();
  const digits = normalizePhoneDigits(phone);
  if (allowed.size === 0) {
    throw new CampaignError(
      'لم يُضبط WHATSAPP_CAMPAIGN_TEST_PHONES — إرسال الاختبار معطّل',
      'TEST_PHONE_DENIED',
      403,
    );
  }
  if (!allowed.has(digits)) {
    throw new CampaignError(
      'رقم الاختبار غير مصرح به في قائمة أرقام المشرف',
      'TEST_PHONE_DENIED',
      403,
    );
  }

  const text = await renderCampaignMessageForRecipient({
    messageMode: input.messageMode,
    templateKey: input.templateKey,
    customMessage: input.customMessage,
    customerName: input.sampleName?.trim() || 'مشرف الاختبار',
    branchName: input.sampleBranchName ?? 'جليم – سابا باشا',
    branchId: input.branchId,
  });

  const idempotencyKey = `campaign:test:${input.userId}:${digits}:${Date.now()}`;

  const result = await enqueueMessage({
    channel: 'whatsapp',
    recipient: { phone },
    content: { text },
    templateKey: input.templateKey ?? WHATSAPP_CAMPAIGN_TEMPLATE_KEY,
    idempotencyKey,
    metadata: {
      source: 'whatsapp.campaign.test',
      marketing: false,
      testOnly: true,
    },
    context: {
      branchId: input.branchId ?? undefined,
      userId: input.userId,
    },
  });

  return { messageId: result.messageId, duplicate: Boolean(result.duplicate) };
}
