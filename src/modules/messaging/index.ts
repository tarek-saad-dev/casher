/**
 * Messaging module public API.
 * Features send through this boundary — not src/lib/integrations/whatsapp.
 */
import 'server-only';

export { sendMessage } from './application/sendMessage';
export { composeMessage, MessageTemplateError } from './application/composeMessage';
export { sendTemplateMessage } from './application/sendTemplateMessage';
export { sendSaleCustomerReceipt } from './application/sendSaleCustomerReceipt';
export { enqueueMessage } from './application/enqueueMessage';
export { listMessageHistory } from './application/listMessageHistory';
export { MessageOutboxError } from './domain/outboxTypes';

export type {
  MessageChannel,
  MessageContent,
  MessageRecipient,
  MessageSendResult,
  SendMessageInput,
} from './domain/types';

export type {
  ComposeMessageInput,
  ComposeMessageResult,
  ComposeMessageContext,
  MessageTemplateSource,
} from './domain/templateTypes';

export type {
  SendTemplateMessageInput,
  SendTemplateMessageContext,
  SendTemplateMessageRecipient,
} from './application/sendTemplateMessage';

export type {
  EnqueueMessageInput,
  EnqueueMessageResult,
  ListMessageHistoryInput,
  ListMessageHistoryResult,
  MessageHistoryItem,
  OutboxMessageStatus,
} from './domain/outboxTypes';

export { SUPPORTED_MESSAGE_CHANNELS } from './domain/types';
export {
  SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,
  CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
  SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
  BOOKING_CONFIRMATION_TEMPLATE_KEY,
  EMPLOYEE_ADVANCE_TEMPLATE_KEY,
  EMPLOYEE_FUNDING_TEMPLATE_KEY,
  ATTENDANCE_CHECK_IN_TEMPLATE_KEY,
  ATTENDANCE_CHECK_OUT_TEMPLATE_KEY,
  EMPLOYEE_DAILY_REPORT_TEMPLATE_KEY,
  OWNER_DAILY_REPORT_TEMPLATE_KEY,
  EMPLOYEE_TIP_TEMPLATE_KEY,
  WHATSAPP_TEMPLATE_KEYS,
} from './templates/catalog';
export type { SaleCustomerReceiptInput } from './application/sendSaleCustomerReceipt';
export {
  MESSAGE_HISTORY_DEFAULT_LIMIT,
  MESSAGE_HISTORY_MAX_LIMIT,
  OUTBOX_MESSAGE_STATUSES,
} from './domain/outboxTypes';

export {
  createCampaign,
  listCampaigns,
  getCampaign,
  previewCampaignAudience,
  previewCampaignMessage,
  startCampaign,
  cancelCampaign,
  syncCampaignProgress,
  CampaignError,
} from './campaigns';

export type {
  AudienceCriteria,
  AudienceRule,
  CampaignRow,
  CampaignDetail,
  CampaignStatus,
  CampaignMessageMode,
} from './campaigns';
