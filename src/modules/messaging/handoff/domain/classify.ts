import type { ConversationControlMode, MessageActorOrigin } from './types';

export type FromMeClassification =
  | { kind: 'AUTOMATED'; origin: 'BOT' | 'HANDOFF_ACK' }
  | { kind: 'HUMAN_ERP' }
  | { kind: 'WHATSAPP_MANUAL' }
  | { kind: 'AMBIGUOUS' };

export type OutboundCorrelation = {
  providerMessageId: string | null;
  origin: MessageActorOrigin;
  phone: string;
  createdAt: string;
  stamped: boolean;
};

/**
 * Classify a fromMe WhatsApp event.
 * Never treats known bot/ack IDs as human.
 * Pending same-phone send without a stamped ID is AMBIGUOUS (no takeover).
 */
export function classifyFromMeEvent(input: {
  providerMessageId: string;
  known: OutboundCorrelation | null;
  pendingUnstampedForPhone: boolean;
}): FromMeClassification {
  if (input.known) {
    if (input.known.origin === 'BOT' || input.known.origin === 'HANDOFF_ACK') {
      return { kind: 'AUTOMATED', origin: input.known.origin };
    }
    if (input.known.origin === 'HUMAN_ERP') {
      return { kind: 'HUMAN_ERP' };
    }
    if (input.known.origin === 'HUMAN_WHATSAPP') {
      return { kind: 'WHATSAPP_MANUAL' };
    }
  }
  if (input.pendingUnstampedForPhone) {
    return { kind: 'AMBIGUOUS' };
  }
  return { kind: 'WHATSAPP_MANUAL' };
}

export function automatedOutboundPermitted(input: {
  origin: MessageActorOrigin;
  liveMode: ConversationControlMode;
  expectedControlVersion: number | null;
  liveControlVersion: number;
}): { allowed: boolean; reason: string } {
  const versionOk =
    input.expectedControlVersion == null ||
    input.expectedControlVersion === input.liveControlVersion;

  if (input.origin === 'BOT') {
    if (input.liveMode !== 'BOT') {
      return { allowed: false, reason: 'mode_not_bot' };
    }
    if (!versionOk) {
      return { allowed: false, reason: 'control_version_mismatch' };
    }
    return { allowed: true, reason: 'bot_ok' };
  }

  if (input.origin === 'HANDOFF_ACK') {
    if (input.liveMode !== 'HUMAN_REQUESTED') {
      return { allowed: false, reason: 'ack_mode_mismatch' };
    }
    if (!versionOk) {
      return { allowed: false, reason: 'control_version_mismatch' };
    }
    return { allowed: true, reason: 'handoff_ack_ok' };
  }

  return { allowed: true, reason: 'human_or_customer' };
}

export function resumeClaimKey(conversationId: number, latestCustomerMessageId: number): string {
  return `resume:${conversationId}:${latestCustomerMessageId}`;
}

export type TimelineMessage = {
  messageId: number;
  direction: 'inbound' | 'outbound';
  origin: MessageActorOrigin | null;
  occurredAt: string;
};

const MEANINGFUL_OUTBOUND: ReadonlySet<string> = new Set([
  'BOT',
  'HUMAN_ERP',
  'HUMAN_WHATSAPP',
  'HANDOFF_ACK',
]);

export function findLatestUnansweredCustomerTurn(
  messages: TimelineMessage[],
): number | null {
  const ordered = [...messages].sort((a, b) => {
    const t = a.occurredAt.localeCompare(b.occurredAt);
    if (t !== 0) return t;
    return a.messageId - b.messageId;
  });

  let lastOutSeq = -1;
  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i]!;
    const origin = m.origin ?? (m.direction === 'outbound' ? 'BOT' : 'CUSTOMER');
    if (m.direction === 'outbound' && MEANINGFUL_OUTBOUND.has(origin)) {
      lastOutSeq = i;
    }
  }

  let latestInbound: number | null = null;
  for (let i = lastOutSeq + 1; i < ordered.length; i++) {
    const m = ordered[i]!;
    if (m.direction === 'inbound') latestInbound = m.messageId;
  }
  return latestInbound;
}
