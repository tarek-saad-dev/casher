export const BOT_CONVERSATION_CONTROL_MODES = ['BOT', 'HUMAN', 'PAUSED'] as const;
export type BotConversationControlMode = (typeof BOT_CONVERSATION_CONTROL_MODES)[number];

export const BOT_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type BotMessageDirection = (typeof BOT_MESSAGE_DIRECTIONS)[number];

export const DEFAULT_BOT_CHANNEL = 'whatsapp' as const;

export type BotConversationRow = {
  conversationId: number;
  channel: string;
  provider: string;
  externalContactKey: string;
  phone: string;
  clientId: number | null;
  branchId: number | null;
  controlMode: BotConversationControlMode;
  contextJson: string;
  summary: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string | null;
};

export type BotMessageRow = {
  messageId: number;
  conversationId: number;
  inboxId: number | null;
  direction: BotMessageDirection;
  provider: string;
  providerMessageId: string;
  messageType: string;
  text: string | null;
  occurredAt: string;
  createdAt: string;
};

export type BotConversationListItem = {
  conversationId: number;
  channel: string;
  provider: string;
  externalContactKey: string;
  phone: string;
  clientId: number | null;
  branchId: number | null;
  controlMode: BotConversationControlMode;
  lastMessageAt: string;
  createdAt: string;
};

export type BotMessageListItem = {
  messageId: number;
  conversationId: number;
  inboxId: number | null;
  direction: BotMessageDirection;
  messageType: string;
  text: string | null;
  occurredAt: string;
  createdAt: string;
};

export type ProcessInboxMessageResult = {
  inboxId: number;
  conversationId: number;
  messageId: number;
  duplicate: boolean;
  clientLinked: boolean;
  conversationCreated: boolean;
};

export function isBotConversationControlMode(value: string): value is BotConversationControlMode {
  return (BOT_CONVERSATION_CONTROL_MODES as readonly string[]).includes(value);
}

export function isBotMessageDirection(value: string): value is BotMessageDirection {
  return (BOT_MESSAGE_DIRECTIONS as readonly string[]).includes(value);
}
