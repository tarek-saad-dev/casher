import type { ConversationControlMode } from './types';

export type InboxFilter = 'all' | 'needs_takeover' | 'human' | 'bot' | 'unread';

export type InboxListItem = {
  conversationId: number;
  phone: string;
  displayName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string;
  unreadCount: number;
  mode: ConversationControlMode;
  takeoverSource: string | null;
  takenOverByUserId: number | null;
  takenOverByName: string | null;
  controlVersion: number;
};

export function inboxPriorityBucket(item: InboxListItem): number {
  if (item.mode === 'HUMAN_REQUESTED') return 0;
  if (item.mode === 'HUMAN' && item.unreadCount > 0) return 1;
  if (item.unreadCount > 0) return 2;
  return 3;
}

export function sortInboxItems(items: InboxListItem[]): InboxListItem[] {
  return [...items].sort((a, b) => {
    const bucket = inboxPriorityBucket(a) - inboxPriorityBucket(b);
    if (bucket !== 0) return bucket;
    const t = b.lastMessageAt.localeCompare(a.lastMessageAt);
    if (t !== 0) return t;
    return b.conversationId - a.conversationId;
  });
}

export function matchesInboxFilter(item: InboxListItem, filter: InboxFilter): boolean {
  switch (filter) {
    case 'needs_takeover':
      return item.mode === 'HUMAN_REQUESTED';
    case 'human':
      return item.mode === 'HUMAN';
    case 'bot':
      return item.mode === 'BOT';
    case 'unread':
      return item.unreadCount > 0;
    default:
      return true;
  }
}

export function matchesInboxSearch(item: InboxListItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const name = (item.displayName ?? '').toLowerCase();
  const phone = item.phone.replace(/\D/g, '');
  const needleDigits = needle.replace(/\D/g, '');
  if (name.includes(needle)) return true;
  if (item.phone.toLowerCase().includes(needle)) return true;
  if (needleDigits && phone.includes(needleDigits)) return true;
  return false;
}

export function ownershipLabel(item: InboxListItem): string {
  if (item.mode === 'BOT') return 'البوت';
  if (item.mode === 'HUMAN_REQUESTED') return 'محتاج استلام';
  if (item.mode === 'HUMAN') {
    if (item.takenOverByName) return `مستلمة بواسطة ${item.takenOverByName}`;
    if (item.takeoverSource === 'WHATSAPP_MANUAL') return 'مستلمة من واتساب';
    return 'مع موظف';
  }
  return item.mode;
}
