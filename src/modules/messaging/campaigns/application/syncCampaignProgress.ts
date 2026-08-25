import { getById as getOutboxById } from '../../outbox/messageOutboxRepository';
import type { CampaignRecipientStatus } from '../domain/types';
import {
  countRecipientsByStatus,
  getCampaignById,
  listRecipientsByCampaign,
  updateCampaignStatus,
  updateRecipient,
} from '../infra/campaignRepository';

function mapOutboxToRecipientStatus(
  outboxStatus: string,
): CampaignRecipientStatus {
  if (outboxStatus === 'sent') return 'sent';
  if (outboxStatus === 'failed') return 'failed';
  return 'queued';
}

export async function syncCampaignProgress(campaignId: number): Promise<void> {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) return;

  const recipients = await listRecipientsByCampaign(campaignId);

  for (const recipient of recipients) {
    if (!recipient.outboxMessageId) continue;
    if (recipient.status === 'sent' || recipient.status === 'failed' || recipient.status === 'cancelled') {
      continue;
    }

    const outbox = await getOutboxById(recipient.outboxMessageId);
    if (!outbox) continue;

    const nextStatus = mapOutboxToRecipientStatus(outbox.status);
    if (nextStatus === recipient.status) continue;

    await updateRecipient(recipient.id, {
      status: nextStatus,
      lastError: outbox.lastError,
      sentAt: outbox.sentAt ? new Date(outbox.sentAt) : null,
    });
  }

  const summary = await countRecipientsByStatus(campaignId);
  const pendingCount = summary.pending + summary.queued;
  const sentCount = summary.sent;
  const failedCount = summary.failed;

  const patch: Parameters<typeof updateCampaignStatus>[1] = {
    sentCount,
    failedCount,
    pendingCount,
    totalRecipients: Object.values(summary).reduce((a, b) => a + b, 0),
  };

  const refreshed = await getCampaignById(campaignId);
  if (!refreshed) return;

  if (
    refreshed.status === 'running' &&
    summary.pending === 0 &&
    summary.queued === 0
  ) {
    patch.status = 'completed';
    patch.completedAt = new Date();
  }

  await updateCampaignStatus(campaignId, patch);
}
