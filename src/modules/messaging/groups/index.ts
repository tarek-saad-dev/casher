export type {
  WhatsAppGroupEventKey,
  WhatsAppGroupRow,
  WhatsAppGroupInput,
  WhatsAppGroupSendResult,
} from './domain/types';

export {
  WHATSAPP_GROUP_EVENTS,
  isValidWhatsAppGroupEventKey,
  normalizeSubscribedEvents,
} from './domain/eventCatalog';

export {
  isValidWhatsAppGroupInviteLink,
  normalizeWhatsAppGroupInviteLink,
} from './domain/inviteLink';

export {
  WhatsAppGroupError,
  ensureWhatsAppGroupTable,
  listWhatsAppGroups,
  getWhatsAppGroupById,
  createWhatsAppGroup,
  updateWhatsAppGroup,
  deleteWhatsAppGroup,
  listActiveGroupsForEvent,
} from './infra/whatsappGroupRepository';

export {
  scheduleWhatsAppGroupNotifications,
  sendTestGroupMessage,
  type ScheduleGroupNotifyInput,
} from './application/notifyGroups';

export {
  buildGroupMessageForEvent,
  type BookingGroupMessageInput,
  type SaleGroupMessageInput,
} from './application/buildGroupMessage';
