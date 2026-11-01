import { CampaignError } from '../domain/types';
import {
  cancelPendingRecipients,
  getCampaignById,
  updateCampaignStatus,
} from '../infra/campaignRepository';

const PAUSABLE = new Set(['queued', 'running']);

/** Pause a running/queued campaign: cancel pending recipients and mark paused. */
export async function pauseCampaign(campaignId: number) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new CampaignError('الحملة غير موجودة', 'NOT_FOUND', 404);
  }
  if (!PAUSABLE.has(campaign.status)) {
    throw new CampaignError('لا يمكن إيقاف هذه الحملة مؤقتًا', 'INVALID_STATUS', 409);
  }

  await cancelPendingRecipients(campaignId);
  return updateCampaignStatus(campaignId, {
    status: 'paused',
    pendingCount: 0,
  });
}
