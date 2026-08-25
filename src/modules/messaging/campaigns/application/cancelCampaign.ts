import { CampaignError } from '../domain/types';
import {
  cancelPendingRecipients,
  getCampaignById,
  updateCampaignStatus,
} from '../infra/campaignRepository';

const CANCELLABLE = new Set(['draft', 'queued', 'running']);

export async function cancelCampaign(campaignId: number) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new CampaignError('الحملة غير موجودة', 'NOT_FOUND', 404);
  }
  if (!CANCELLABLE.has(campaign.status)) {
    throw new CampaignError('لا يمكن إلغاء هذه الحملة', 'INVALID_STATUS', 409);
  }

  await cancelPendingRecipients(campaignId);
  const updated = await updateCampaignStatus(campaignId, {
    status: 'cancelled',
    cancelledAt: new Date(),
    pendingCount: 0,
  });

  return updated;
}
