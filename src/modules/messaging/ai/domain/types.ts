export const AI_INTENTS = [
  'greeting',
  'booking_request',
  'availability_question',
  'service_question',
  'price_question',
  'branch_question',
  'employee_question',
  'booking_change_request',
  'booking_cancel_request',
  'human_request',
  'complaint',
  'general_question',
  'unknown',
] as const;

export type AiIntent = (typeof AI_INTENTS)[number];

export type AiTurnStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export type AiTurnRow = {
  turnId: number;
  conversationId: number;
  anchorInboundMessageId: number;
  latestInboundMessageId: number;
  status: AiTurnStatus;
  controlModeSnapshot: 'BOT' | 'HUMAN_REQUESTED' | 'HUMAN' | 'PAUSED';
  debounceUntil: string;
  outboundMessageId: number | null;
  outboxId: number | null;
  intent: string | null;
  confidence: number | null;
  needsBusinessTool: boolean | null;
  resultJson: string | null;
  lastError: string | null;
  errorCode: string | null;
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: string | null;
  processingStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type AiConversationContextMessage = {
  messageId: number;
  direction: 'inbound' | 'outbound';
  text: string;
  occurredAt: string;
};

export type AiConversationContext = {
  conversationId: number;
  phone: string;
  controlMode: 'BOT' | 'HUMAN_REQUESTED' | 'HUMAN' | 'PAUSED';
  messages: AiConversationContextMessage[];
  burstInboundMessageIds: number[];
};

export type AiEntities = {
  dateText: string | null;
  timeText: string | null;
  employeeName: string | null;
  serviceText: string | null;
  branchText: string | null;
};

export type AiToolCallDraft = {
  name: string;
  branchCode: string | null;
  serviceQuery: string | null;
  employeeName: string | null;
  dateText: string | null;
  timePreference: string | null;
};

export type AiStructuredResult = {
  replyText: string;
  intent: AiIntent;
  confidence: number;
  needsBusinessTool: boolean;
  missingInformation: string[];
  entities: AiEntities;
  shouldReply: boolean;
  toolCalls: AiToolCallDraft[];
};

export type GenerateConversationTurnInput = {
  systemInstructions: string;
  conversation: AiConversationContext;
  /** Prior tool results for grounded final reply generation. */
  toolResultsJson?: string | null;
};

export type GenerateConversationTurnOutput = {
  result: AiStructuredResult;
  model: string;
  latencyMs: number;
};

export type ProcessAiTurnResult = {
  turnId: number;
  status: AiTurnStatus;
  duplicate: boolean;
  outboundMessageId: number | null;
  outboxId: number | null;
  skipped: boolean;
};
