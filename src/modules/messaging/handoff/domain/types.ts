export const CONVERSATION_CONTROL_MODES = [
  'BOT',
  'HUMAN_REQUESTED',
  'HUMAN',
  'PAUSED',
] as const;

export type ConversationControlMode = (typeof CONVERSATION_CONTROL_MODES)[number];

export const HANDOFF_TAKEOVER_SOURCES = [
  'ERP',
  'WHATSAPP_MANUAL',
  'CUSTOMER_REQUEST',
] as const;

export type HandoffTakeoverSource = (typeof HANDOFF_TAKEOVER_SOURCES)[number];

export const MESSAGE_ACTOR_ORIGINS = [
  'CUSTOMER',
  'BOT',
  'HUMAN_ERP',
  'HUMAN_WHATSAPP',
  'HANDOFF_ACK',
] as const;

export type MessageActorOrigin = (typeof MESSAGE_ACTOR_ORIGINS)[number];

export const HANDOFF_ACK_AR =
  'أكيد يا فندم، هخلي حد من الاستقبال يكمل مع حضرتك.';

export type ConversationControlState = {
  conversationId: number;
  mode: ConversationControlMode;
  controlVersion: number;
  humanLeaseUntil: string | null;
  humanLastActivityAt: string | null;
  takeoverSource: HandoffTakeoverSource | null;
  takenOverByUserId: number | null;
  handoffReason: string | null;
  handoffRequestedAt: string | null;
  lastHumanMessageId: number | null;
  lastBotMessageId: number | null;
  lastCustomerMessageId: number | null;
  unreadCount: number;
};

export type ControlTransition = {
  previousMode: ConversationControlMode;
  newMode: ConversationControlMode;
  source: HandoffTakeoverSource | 'LEASE_EXPIRED' | 'ERP_RETURN' | 'SYSTEM';
  reason: string;
  actorUserId: number | null;
  relatedMessageId: number | null;
  controlVersion: number;
};

export type ApplyControlResult =
  | { ok: true; changed: boolean; state: ConversationControlState; event: ControlTransition | null }
  | { ok: false; code: 'VERSION_CONFLICT' | 'OWNED_BY_OTHER' | 'NOT_FOUND'; state: ConversationControlState | null };

export function isConversationControlMode(value: string): value is ConversationControlMode {
  return (CONVERSATION_CONTROL_MODES as readonly string[]).includes(value);
}

export function isHandoffTakeoverSource(value: string): value is HandoffTakeoverSource {
  return (HANDOFF_TAKEOVER_SOURCES as readonly string[]).includes(value);
}

export function isMessageActorOrigin(value: string): value is MessageActorOrigin {
  return (MESSAGE_ACTOR_ORIGINS as readonly string[]).includes(value);
}

export function aiIsSuppressed(mode: ConversationControlMode): boolean {
  return mode === 'HUMAN' || mode === 'HUMAN_REQUESTED';
}

export function botAutomatedSendAllowed(mode: ConversationControlMode): boolean {
  return mode === 'BOT';
}
