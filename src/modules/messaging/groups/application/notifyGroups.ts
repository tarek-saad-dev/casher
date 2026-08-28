import { sendWhatsAppGroupMessage } from '@/lib/integrations/whatsapp';
import { getWhatsAppConfig } from '@/lib/integrations/whatsapp/config';
import { schedulePostResponse } from '@/lib/schedulePostResponse';
import { buildGroupMessageForEvent } from './buildGroupMessage';
import { listActiveGroupsForEvent } from '../infra/whatsappGroupRepository';
import type {
  WhatsAppGroupEventKey,
  WhatsAppGroupSendResult,
} from '../domain/types';
import type {
  BookingGroupMessageInput,
  SaleGroupMessageInput,
} from './buildGroupMessage';

export type GroupNotifyVariables = BookingGroupMessageInput | SaleGroupMessageInput;

export type ScheduleGroupNotifyInput = {
  eventKey: WhatsAppGroupEventKey;
  branchId?: number | null;
  variables: GroupNotifyVariables;
};

async function sendToSubscribedGroups(
  input: ScheduleGroupNotifyInput,
): Promise<WhatsAppGroupSendResult[]> {
  const cfg = getWhatsAppConfig();
  if (!cfg.enabled) {
    return [];
  }

  const groups = await listActiveGroupsForEvent(input.eventKey, input.branchId);
  if (groups.length === 0) return [];

  const message = buildGroupMessageForEvent(input.eventKey, input.variables);
  if (!message.trim()) return [];

  const results: WhatsAppGroupSendResult[] = [];

  for (const group of groups) {
    const result = await sendWhatsAppGroupMessage({
      groupInviteLink: group.inviteLink,
      message,
    });
    results.push({
      groupId: group.id,
      groupName: group.name,
      sent: result.sent === true,
      skipped: result.skipped === true,
      reason: 'reason' in result ? result.reason : undefined,
      messageId: result.sent ? result.messageId : undefined,
    });
  }

  return results;
}

/**
 * Schedules WhatsApp group notifications after HTTP response.
 * Best-effort — never blocks the main transaction.
 */
export function scheduleWhatsAppGroupNotifications(
  input: ScheduleGroupNotifyInput,
  deps?: {
    schedule?: typeof schedulePostResponse;
    send?: typeof sendToSubscribedGroups;
  },
): { scheduled: true } {
  const schedule = deps?.schedule ?? schedulePostResponse;
  const send = deps?.send ?? sendToSubscribedGroups;

  schedule(async () => {
    try {
      const results = await send(input);
      if (process.env.NODE_ENV !== 'production' && results.length > 0) {
        console.log('[whatsapp/groups] notifications completed', {
          eventKey: input.eventKey,
          groups: results.length,
          sent: results.filter((r) => r.sent).length,
        });
      }
    } catch (err) {
      console.log('[whatsapp/groups] notification error (non-critical)', {
        eventKey: input.eventKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { scheduled: true };
}

/** Immediate send — used by admin test button. */
export async function sendTestGroupMessage(
  groupId: number,
  message: string,
): Promise<WhatsAppGroupSendResult> {
  const { getWhatsAppGroupById } = await import('../infra/whatsappGroupRepository');
  const group = await getWhatsAppGroupById(groupId);
  if (!group) {
    return {
      groupId,
      groupName: '',
      sent: false,
      reason: 'not_found',
    };
  }

  const result = await sendWhatsAppGroupMessage({
    groupInviteLink: group.inviteLink,
    message,
  });

  return {
    groupId: group.id,
    groupName: group.name,
    sent: result.sent === true,
    skipped: result.skipped === true,
    reason: 'reason' in result ? result.reason : undefined,
    messageId: result.sent ? result.messageId : undefined,
  };
}
