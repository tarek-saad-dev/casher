import { composeMessage } from '../../application/composeMessage';
import type { CampaignMessageMode } from '../domain/types';
import { CampaignError } from '../domain/types';

export type CampaignMessageVars = {
  customerName: string;
  firstName?: string;
  branchName?: string | null;
};

function resolveFirstName(input: CampaignMessageVars): string {
  const explicit = String(input.firstName ?? '').trim();
  if (explicit) return explicit;
  const full = String(input.customerName ?? '').trim();
  if (!full) return 'عميلنا';
  return full.split(/\s+/)[0] || 'عميلنا';
}

export function renderCustomCampaignMessage(
  template: string,
  vars: CampaignMessageVars | string,
): string {
  const normalized: CampaignMessageVars =
    typeof vars === 'string' ? { customerName: vars } : vars;
  const fullName = String(normalized.customerName ?? '').trim() || 'عميلنا';
  const firstName = resolveFirstName({ ...normalized, customerName: fullName });
  const branchName = String(normalized.branchName ?? '').trim() || 'CUT Salon';

  return template
    .replace(/\{\{customerName\}\}/g, fullName)
    .replace(/\{\{name\}\}/g, fullName)
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{branch_name\}\}/g, branchName)
    .replace(/\{\{branchName\}\}/g, branchName);
}

export async function renderCampaignMessageForRecipient(input: {
  messageMode: CampaignMessageMode;
  templateKey?: string | null;
  customMessage?: string | null;
  customerName: string;
  firstName?: string;
  branchName?: string | null;
  branchId?: number | null;
}): Promise<string> {
  const fullName = input.customerName.trim() || 'عميلنا';
  const firstName = resolveFirstName({
    customerName: fullName,
    firstName: input.firstName,
  });
  const branchName = input.branchName?.trim() || null;

  if (input.messageMode === 'custom') {
    const text = String(input.customMessage ?? '').trim();
    if (!text) {
      throw new CampaignError('نص الرسالة المخصصة مطلوب', 'INVALID_MESSAGE');
    }
    return renderCustomCampaignMessage(text, {
      customerName: fullName,
      firstName,
      branchName,
    });
  }

  const templateKey = String(input.templateKey ?? '').trim();
  if (!templateKey) {
    throw new CampaignError('يجب اختيار قالب الرسالة', 'INVALID_MESSAGE');
  }

  const composed = await composeMessage({
    templateKey,
    variables: {
      customerName: fullName,
      first_name: firstName,
      firstName,
      branch_name: branchName ?? 'CUT Salon',
      branchName: branchName ?? 'CUT Salon',
    },
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
  sampleBranchName?: string | null;
  branchId?: number | null;
}): Promise<string> {
  return renderCampaignMessageForRecipient({
    messageMode: input.messageMode,
    templateKey: input.templateKey,
    customMessage: input.customMessage,
    customerName: input.sampleName?.trim() || 'عميل تجريبي',
    firstName: undefined,
    branchName: input.sampleBranchName ?? 'جليم – سابا باشا',
    branchId: input.branchId,
  });
}
