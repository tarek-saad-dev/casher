import { enqueueMessage } from '../../application/enqueueMessage';
import { buildCampaignAudience } from '../audience/previewAudience';
import { normalizePhoneDigits } from '../audience/normalizePhone';
import {
  CampaignError,
  WHATSAPP_CAMPAIGN_TEMPLATE_KEY,
  buildRecipientIdempotencyKey,
  parseAudienceCriteria,
} from '../domain/types';
import {
  getCampaignById,
  getRecipientByIdempotencyKey,
  insertCampaignRecipient,
  updateCampaignStatus,
  updateRecipient,
} from '../infra/campaignRepository';
import { renderCampaignMessageForRecipient } from './renderCampaignMessage';

export async function startCampaign(input: {
  campaignId: number;
  userId: number;
}): Promise<{ campaignId: number; totalRecipients: number; enqueued: number }> {
  const campaign = await getCampaignById(input.campaignId);
  if (!campaign) {
    throw new CampaignError('الحملة غير موجودة', 'NOT_FOUND', 404);
  }
  if (campaign.status !== 'draft') {
    throw new CampaignError('يمكن بدء الحملات في وضع المسودة فقط', 'INVALID_STATUS', 409);
  }

  const audience = parseAudienceCriteria(campaign.audienceJson);
  const members = await buildCampaignAudience(audience);
  if (members.length === 0) {
    throw new CampaignError('لا يوجد مستلمون مطابقون للجمهور المحدد', 'EMPTY_AUDIENCE', 422);
  }

  await updateCampaignStatus(campaign.id, {
    status: 'queued',
    totalRecipients: members.length,
    pendingCount: members.length,
    sentCount: 0,
    failedCount: 0,
    startedAt: new Date(),
  });

  let enqueued = 0;

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const current = await getCampaignById(campaign.id);
    if (!current || current.status === 'cancelled') {
      for (let j = i; j < members.length; j++) {
        const pendingMember = members[j];
        const normalized = normalizePhoneDigits(pendingMember.phone);
        const key = buildRecipientIdempotencyKey(campaign.id, pendingMember.clientId, normalized);
        const existing = await getRecipientByIdempotencyKey(key);
        if (existing && existing.status === 'pending') {
          await updateRecipient(existing.id, { status: 'cancelled' });
        }
      }
      break;
    }

    const messageContent = await renderCampaignMessageForRecipient({
      messageMode: campaign.messageMode,
      templateKey: campaign.templateKey,
      customMessage: campaign.customMessage,
      customerName: member.name,
      branchId: campaign.branchId,
    });

    const normalizedPhone = normalizePhoneDigits(member.phone);
    const idempotencyKey = buildRecipientIdempotencyKey(
      campaign.id,
      member.clientId,
      normalizedPhone,
    );

    let recipient = await getRecipientByIdempotencyKey(idempotencyKey);
    if (!recipient) {
      recipient = await insertCampaignRecipient({
        campaignId: campaign.id,
        customerId: member.clientId,
        customerName: member.name,
        phone: member.phone,
        messageContent,
        idempotencyKey,
      });
    }

    try {
      const result = await enqueueMessage({
        channel: 'whatsapp',
        recipient: { phone: member.phone },
        content: { text: messageContent },
        templateKey: campaign.templateKey ?? WHATSAPP_CAMPAIGN_TEMPLATE_KEY,
        idempotencyKey,
        metadata: {
          source: 'whatsapp.campaign',
          campaignId: campaign.id,
          customerId: member.clientId,
          branchId: campaign.branchId ?? undefined,
        },
        context: {
          branchId: campaign.branchId ?? undefined,
          userId: input.userId,
        },
      });

      await updateRecipient(recipient.id, {
        outboxMessageId: result.messageId,
        status: 'queued',
      });
      enqueued += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateRecipient(recipient.id, {
        status: 'failed',
        lastError: message,
      });
    }
  }

  const after = await getCampaignById(campaign.id);
  if (after && after.status !== 'cancelled') {
    const nextStatus =
      after.pendingCount === 0 && after.sentCount + after.failedCount >= after.totalRecipients
        ? 'completed'
        : 'running';
    await updateCampaignStatus(campaign.id, {
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? new Date() : null,
    });
  }

  const finalRow = await getCampaignById(campaign.id);
  return {
    campaignId: campaign.id,
    totalRecipients: finalRow?.totalRecipients ?? members.length,
    enqueued,
  };
}
