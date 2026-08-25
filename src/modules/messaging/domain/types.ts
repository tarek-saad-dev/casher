export const SUPPORTED_MESSAGE_CHANNELS = ['whatsapp'] as const;

export type MessageChannel = (typeof SUPPORTED_MESSAGE_CHANNELS)[number];

export interface MessageRecipient {
  phone: string;
}

export interface MessageContent {
  text: string;
}

export interface SendMessageInput {
  channel: MessageChannel;
  recipient: MessageRecipient;
  content: MessageContent;
  metadata?: Record<string, unknown>;
}

export type MessageSendResult =
  | {
      sent: true;
      channel: 'whatsapp';
      messageId: string;
    }
  | {
      sent: false;
      channel: string;
      reason: string;
      skipped?: boolean;
      error?: string;
    };
