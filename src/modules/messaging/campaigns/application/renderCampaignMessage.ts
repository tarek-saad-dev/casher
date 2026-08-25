import { composeMessage } from '../../application/composeMessage';
import type { CampaignMessageMode } from '../domain/types';
import { CampaignError } from '../domain/types';

export function renderCustomCampaignMessage(
  template: string,
  customerName: string,
): string {
  const name = customerName.trim() || 'عميلنا';
  return template
    .replace(/\{\{customerName\}\}/g, name)
    .replace(/\{\{name\}\}/g, name);
}

export async function renderCampaignMessageForRecipient(input: {
  messageMode: CampaignMessageMode;
  templateKey?: string | null;
  customMessage?: string | null;
  customerName: string;
  branchId?: number | null;
}): Promise<string> {
  const name = input.customerName.trim() || 'عميلنا';

  if (input.messageMode === 'custom') {
    const text = String(input.customMessage ?? '').trim();
    if (!text) {
      throw new CampaignError('نص الرسالة المخصصة مطلوب', 'INVALID_MESSAGE');
    }
    return renderCustomCampaignMessage(text, name);
  }

  const templateKey = String(input.templateKey ?? '').trim();
  if (!templateKey) {
    throw new CampaignError('يجب اختيار قالب الرسالة', 'INVALID_MESSAGE');
  }

  const composed = await composeMessage({
    templateKey,
    variables: { customerName: name },
    context: {
      channel: 'whatsapp',
      language: 'ar',
      branchId: input.branchId ?? undefined,
    },
  });
  return composed.text;
}

export async function previewCampaignMessage(input: {
  messageMode: CampaignMessageMode;
  templateKey?: string | null;
  customMessage?: string | null;
  sampleName?: string;
  branchId?: number | null;
}): Promise<string> {
  return renderCampaignMessageForRecipient({
    messageMode: input.messageMode,
    templateKey: input.templateKey,
    customMessage: input.customMessage,
    customerName: input.sampleName?.trim() || 'عميل تجريبي',
    branchId: input.branchId,
  });
}
