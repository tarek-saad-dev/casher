import type { ConversationControlStore } from '../application/store';
import {
  getConversationControl,
  persistControlState,
  persistControlFieldsNoVersion,
  markConversationRead,
  listExpiredHandoffConversations,
  tryInsertResumeClaim,
} from './conversationControlRepository';

export const sqlConversationControlStore: ConversationControlStore = {
  get: getConversationControl,
  persist: persistControlState,
  persistFields: persistControlFieldsNoVersion,
  markRead: markConversationRead,
  listExpired: listExpiredHandoffConversations,
  tryResumeClaim: tryInsertResumeClaim,
};
