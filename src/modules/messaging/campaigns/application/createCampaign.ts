import {
  CampaignError,
  isCampaignMessageMode,
  type AudienceCriteria,
  type CreateCampaignInput,
} from '../domain/types';
import { insertCampaign } from '../infra/campaignRepository';

function validateAudience(audience: AudienceCriteria): void {
  if (!audience || !['all', 'rules', 'segment'].includes(audience.mode)) {
    throw new CampaignError('وضع الجمهور غير صالح', 'INVALID_INPUT');
  }
  if (audience.mode === 'segment' && !audience.segmentType) {
    throw new CampaignError('يجب اختيار نوع الشريحة', 'INVALID_INPUT');
  }
}

export async function createCampaign(input: {
  name: string;
  messageMode: string;
  templateKey?: string | null;
  customMessage?: string | null;
  audience: AudienceCriteria;
  branchId?: number | null;
  scheduledAt?: string | null;
  createdByUserId: number;
}) {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new CampaignError('اسم الحملة مطلوب', 'INVALID_INPUT');
  }
  if (!isCampaignMessageMode(input.messageMode)) {
    throw new CampaignError('نوع الرسالة غير صالح', 'INVALID_INPUT');
  }
  validateAudience(input.audience);

  if (input.messageMode === 'template' && !String(input.templateKey ?? '').trim()) {
    throw new CampaignError('يجب اختيار قالب الرسالة', 'INVALID_INPUT');
  }
  if (input.messageMode === 'custom' && !String(input.customMessage ?? '').trim()) {
    throw new CampaignError('نص الرسالة المخصصة مطلوب', 'INVALID_INPUT');
  }

  const payload: CreateCampaignInput = {
    name,
    messageMode: input.messageMode,
    templateKey: input.templateKey ?? null,
    customMessage: input.customMessage ?? null,
    audience: input.audience,
    branchId: input.branchId ?? null,
    scheduledAt: input.scheduledAt ?? null,
    createdByUserId: input.createdByUserId,
  };

  return insertCampaign(payload);
}
