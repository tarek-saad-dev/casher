import type { OutboxMessageRow } from '@/modules/messaging/domain/outboxTypes';
import { parseOutboxMetadataJson } from '@/modules/messaging/outbox/serializeMetadata';
import { automatedOutboundPermitted } from '../domain/classify';
import type { MessageActorOrigin } from '../domain/types';
import { isMessageActorOrigin } from '../domain/types';
import { isHumanHandoffActiveForPhone, isHumanHandoffV1Enabled } from '../featureFlag';
import { getConversationControl } from '../infra/conversationControlRepository';
import {
  insertOutboundCorrelation,
  stampOutboundCorrelation,
} from '../infra/outboundCorrelationRepository';
import { logHandoffEvent } from '../observability';

export type OutboxSendGateResult =
  | { allow: true; origin: MessageActorOrigin | null; correlationInserted: boolean }
  | { allow: false; reason: string; origin: MessageActorOrigin | null };

function resolveOrigin(meta: Record<string, unknown> | null): MessageActorOrigin | null {
  if (!meta) return null;
  if (typeof meta.origin === 'string' && isMessageActorOrigin(meta.origin)) return meta.origin;
  if (meta.source === 'ai-receptionist') return 'BOT';
  if (meta.source === 'erp-inbox') return 'HUMAN_ERP';
  return null;
}

/**
 * Gate automated BOT / HANDOFF_ACK outbox sends. Inserts outbound correlation before send when applicable.
 */
export async function evaluateOutboxSendGate(
  row: OutboxMessageRow,
): Promise<OutboxSendGateResult> {
  if (!isHumanHandoffActiveForPhone(row.recipient)) {
    return { allow: true, origin: null, correlationInserted: false };
  }

  const meta = parseOutboxMetadataJson(row.metadataJson);
  const origin = resolveOrigin(meta);
  const conversationId =
    typeof meta?.conversationId === 'number'
      ? meta.conversationId
      : Number(meta?.conversationId);
  const expectedControlVersion =
    typeof meta?.expectedControlVersion === 'number'
      ? meta.expectedControlVersion
      : meta?.expectedControlVersion != null
        ? Number(meta.expectedControlVersion)
        : null;

  const hasConversation = Number.isFinite(conversationId) && conversationId > 0;
  if (!hasConversation || !origin) {
    return { allow: true, origin, correlationInserted: false };
  }

  if (origin === 'BOT' || origin === 'HANDOFF_ACK') {
    const live = await getConversationControl(conversationId);
    if (!live) {
      return { allow: false, reason: 'conversation_missing', origin };
    }
    const decision = automatedOutboundPermitted({
      origin,
      liveMode: live.mode,
      expectedControlVersion: Number.isFinite(expectedControlVersion as number)
        ? (expectedControlVersion as number)
        : null,
      liveControlVersion: live.controlVersion,
    });
    if (!decision.allowed) {
      logHandoffEvent('ai_outbound_suppressed_before_provider_send', {
        outboxId: row.id,
        conversationId,
        origin,
        reason: decision.reason,
        expectedControlVersion,
        liveControlVersion: live.controlVersion,
        liveMode: live.mode,
      });
      logHandoffEvent('bot_outbound_suppressed_control_version', {
        outboxId: row.id,
        conversationId,
        origin,
        reason: decision.reason,
        expectedControlVersion,
        liveControlVersion: live.controlVersion,
        liveMode: live.mode,
      });
      return { allow: false, reason: decision.reason, origin };
    }
  }

  try {
    await insertOutboundCorrelation({
      outboxId: row.id,
      conversationId,
      phone: row.recipient.replace(/\D/g, '') || row.recipient,
      origin,
      expectedControlVersion: Number.isFinite(expectedControlVersion as number)
        ? (expectedControlVersion as number)
        : null,
    });
    return { allow: true, origin, correlationInserted: true };
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'outbound_correlation_insert_failed',
        outboxId: row.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { allow: true, origin, correlationInserted: false };
  }
}

export async function stampOutboxCorrelationAfterSend(input: {
  outboxId: number;
  providerMessageId: string;
}): Promise<void> {
  if (!isHumanHandoffV1Enabled()) return;
  try {
    await stampOutboundCorrelation(input);
  } catch (err) {
    console.error(
      JSON.stringify({
        type: 'outbound_correlation_stamp_failed',
        outboxId: input.outboxId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
