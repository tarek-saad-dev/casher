import {
  CAMPAIGN_RECIPIENT_STATUSES,
  CampaignError,
  parseAudienceCriteria,
  type CampaignDetail,
  type CampaignProgress,
  type CampaignRecipientStatus,
} from '../domain/types';
import {
  countRecipientsByStatus,
  getCampaignById,
} from '../infra/campaignRepository';
import { syncCampaignProgress } from './syncCampaignProgress';

function buildProgress(
  row: {
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    pendingCount: number;
  },
  summary: Record<CampaignRecipientStatus, number>,
): CampaignProgress {
  return {
    totalRecipients: row.totalRecipients,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    pendingCount: row.pendingCount,
    queuedCount: summary.queued,
    cancelledCount: summary.cancelled,
    skippedCount: summary.skipped,
  };
}

export async function getCampaign(id: number, options?: { sync?: boolean }): Promise<CampaignDetail> {
  if (options?.sync !== false) {
    await syncCampaignProgress(id);
  }

  const row = await getCampaignById(id);
  if (!row) {
    throw new CampaignError('الحملة غير موجودة', 'NOT_FOUND', 404);
  }

  const summary = await countRecipientsByStatus(id);
  const audience = parseAudienceCriteria(row.audienceJson);

  const recipientSummary = CAMPAIGN_RECIPIENT_STATUSES.reduce(
    (acc, status) => {
      acc[status] = summary[status];
      return acc;
    },
    {} as Record<CampaignRecipientStatus, number>,
  );

  return {
    ...row,
    audience,
    progress: buildProgress(row, summary),
    recipientSummary,
  };
}
