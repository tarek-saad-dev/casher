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
  /** Required for NOV-PRO600 and recommended for all campaigns */
  explicitApproval?: boolean;
}): Promise<{
  campaignId: number;
  totalRecipients: number;
  enqueued: number;
  skipped: number;
}> {
  const campaign = await getCampaignById(input.campaignId);
  if (!campaign) {
    throw new CampaignError('الحملة غير موجودة', 'NOT_FOUND', 404);
  }
  if (campaign.status !== 'draft' && campaign.status !== 'paused') {
    throw new CampaignError('يمكن بدء الحملات في وضع المسودة أو المتوقفة فقط', 'INVALID_STATUS', 409);
  }

  const audience = parseAudienceCriteria(campaign.audienceJson);

  if (audience.mode === 'nov_pro600') {
    if (!input.explicitApproval) {
      throw new CampaignError(
        'مطلوب موافقة صريحة قبل بدء حملة NOV-PRO600',
        'APPROVAL_REQUIRED',
        403,
      );
    }
    // Marketing traffic must use an approved template key when available.
    if (campaign.messageMode !== 'template' || !String(campaign.templateKey ?? '').trim()) {
      throw new CampaignError(
        'حملات NOV-PRO600 تتطلب قالب واتساب معتمد (template) وليس رسالة حرة غير معتمدة',
        'INVALID_MESSAGE',
        422,
      );
    }
  }

  const members = await buildCampaignAudience(audience);
  if (members.length === 0) {
    if (audience.mode === 'nov_pro600') {
      throw new CampaignError(
        'لا يوجد مستلمون مؤهلون للإرسال (تحقق من أدلة الموافقة التسويقية والاستثناءات)',
        'CONSENT_REQUIRED',
        422,
      );
    }
    throw new CampaignError('لا يوجد مستلمون مطابقون للجمهور المحدد', 'EMPTY_AUDIENCE', 422);
  }

  // Deduplicate by normalized phone within this campaign snapshot
  const seenPhones = new Set<string>();
  const uniqueMembers = members.filter((m) => {
    const key = normalizePhoneDigits(m.phone);
    if (!key || seenPhones.has(key)) return false;
    seenPhones.add(key);
    return true;
  });

  await updateCampaignStatus(campaign.id, {
    status: 'queued',
    totalRecipients: uniqueMembers.length,
    pendingCount: uniqueMembers.length,
    sentCount: 0,
    failedCount: 0,
    startedAt: new Date(),
    cancelledAt: null,
    lastError: null,
  });

  let enqueued = 0;
  let skipped = 0;

  for (let i = 0; i < uniqueMembers.length; i++) {
    const member = uniqueMembers[i];
    const current = await getCampaignById(campaign.id);
    if (!current || current.status === 'cancelled' || current.status === 'paused') {
      for (let j = i; j < uniqueMembers.length; j++) {
        const pendingMember = uniqueMembers[j];
        const normalized = normalizePhoneDigits(pendingMember.phone);
        const key = buildRecipientIdempotencyKey(campaign.id, pendingMember.clientId, normalized);
        const existing = await getRecipientByIdempotencyKey(key);
        if (existing && existing.status === 'pending') {
          await updateRecipient(existing.id, { status: 'cancelled' });
        }
      }
      break;
    }

    if (audience.mode === 'nov_pro600' && member.sendEligible === false) {
      skipped += 1;
      continue;
    }

    const messageContent = await renderCampaignMessageForRecipient({
      messageMode: campaign.messageMode,
      templateKey: campaign.templateKey,
      customMessage: campaign.customMessage,
      customerName: member.name,
      firstName: member.firstName,
      branchName: member.branchName,
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
    } else if (recipient.status === 'sent' || recipient.status === 'cancelled') {
      // Already finalized — skip without re-enqueue
      continue;
    }

    try {
      // Always call enqueue with the same idempotency key so retries are duplicate-safe.
      const result = await enqueueMessage({
        channel: 'whatsapp',
        recipient: { phone: member.phone },
        content: { text: messageContent },
        templateKey: campaign.templateKey ?? WHATSAPP_CAMPAIGN_TEMPLATE_KEY,
        idempotencyKey,
        metadata: {
          source: 'whatsapp.campaign',
          campaignId: campaign.id,
          campaignCode: audience.mode === 'nov_pro600' ? 'NOV-PRO600' : undefined,
          customerId: member.clientId,
          branchId: campaign.branchId ?? undefined,
          consentEvidence: member.consentEvidence ?? undefined,
          segment: member.segment ?? undefined,
          marketing: audience.mode === 'nov_pro600',
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
  if (after && after.status !== 'cancelled' && after.status !== 'paused') {
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
    totalRecipients: finalRow?.totalRecipients ?? uniqueMembers.length,
    enqueued,
    skipped,
  };
}
