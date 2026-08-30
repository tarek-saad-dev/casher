import { describe, expect, it } from 'vitest';
import {
  matchesInboxFilter,
  matchesInboxSearch,
  ownershipLabel,
  sortInboxItems,
  type InboxListItem,
} from '@/modules/messaging/handoff/domain/inboxRanking';
import { automatedOutboundPermitted } from '@/modules/messaging/handoff/domain/classify';
import type { ConversationControlState } from '@/modules/messaging/handoff/domain/types';
import {
  requestCustomerHandoff,
  takeoverConversationErp,
  withControlDeps,
} from '@/modules/messaging/handoff/application/commands';
import type { ConversationControlStore } from '@/modules/messaging/handoff/application/store';
import { HandoffError } from '@/modules/messaging/handoff/application/errors';

function item(over: Partial<InboxListItem>): InboxListItem {
  return {
    conversationId: 1,
    phone: '2010',
    displayName: null,
    lastMessagePreview: 'hi',
    lastMessageAt: '2026-08-30T10:00:00.000Z',
    unreadCount: 0,
    mode: 'BOT',
    takeoverSource: null,
    takenOverByUserId: null,
    takenOverByName: null,
    controlVersion: 1,
    ...over,
  };
}

function memoryStore(seed: ConversationControlState): ConversationControlStore {
  let state = { ...seed };
  const claims = new Set<string>();
  return {
    async get() {
      return { ...state };
    },
    async persist(input) {
      if (input.previous.controlVersion !== state.controlVersion) {
        return { ok: false, code: 'VERSION_CONFLICT' };
      }
      state = { ...input.next };
      return { ok: true };
    },
    async persistFields(next) {
      state = { ...next, controlVersion: state.controlVersion };
    },
    async markRead() {
      state = { ...state, unreadCount: 0 };
    },
    async listExpired() {
      return [];
    },
    async tryResumeClaim(input) {
      if (claims.has(input.claimKey)) return { claimed: false };
      claims.add(input.claimKey);
      return { claimed: true };
    },
  };
}

describe('inbox ranking', () => {
  it('prioritizes HUMAN_REQUESTED then HUMAN unread then other unread', () => {
    const sorted = sortInboxItems([
      item({ conversationId: 1, mode: 'BOT', lastMessageAt: 't9', unreadCount: 0 }),
      item({ conversationId: 2, mode: 'BOT', lastMessageAt: 't8', unreadCount: 2 }),
      item({ conversationId: 3, mode: 'HUMAN', lastMessageAt: 't7', unreadCount: 1 }),
      item({ conversationId: 4, mode: 'HUMAN_REQUESTED', lastMessageAt: 't1' }),
    ]);
    expect(sorted.map((x) => x.conversationId)).toEqual([4, 3, 2, 1]);
  });

  it('filters and searches', () => {
    const row = item({ mode: 'HUMAN_REQUESTED', displayName: 'كريم', phone: '201012345678' });
    expect(matchesInboxFilter(row, 'needs_takeover')).toBe(true);
    expect(matchesInboxFilter(row, 'bot')).toBe(false);
    expect(matchesInboxSearch(row, 'كريم')).toBe(true);
    expect(matchesInboxSearch(row, '1234')).toBe(true);
  });

  it('ownership labels', () => {
    expect(ownershipLabel(item({ mode: 'BOT' }))).toBe('البوت');
    expect(ownershipLabel(item({ mode: 'HUMAN_REQUESTED' }))).toBe('محتاج استلام');
    expect(
      ownershipLabel(
        item({ mode: 'HUMAN', takeoverSource: 'WHATSAPP_MANUAL', takenOverByName: null }),
      ),
    ).toBe('مستلمة من واتساب');
    expect(
      ownershipLabel(item({ mode: 'HUMAN', takenOverByName: 'سارة' })),
    ).toBe('مستلمة بواسطة سارة');
  });
});

describe('automated outbound gate', () => {
  it('blocks stale BOT version and allows valid BOT', () => {
    expect(
      automatedOutboundPermitted({
        origin: 'BOT',
        liveMode: 'BOT',
        expectedControlVersion: 1,
        liveControlVersion: 2,
      }).allowed,
    ).toBe(false);
    expect(
      automatedOutboundPermitted({
        origin: 'BOT',
        liveMode: 'BOT',
        expectedControlVersion: 2,
        liveControlVersion: 2,
      }).allowed,
    ).toBe(true);
  });

  it('allows HANDOFF_ACK only in HUMAN_REQUESTED', () => {
    expect(
      automatedOutboundPermitted({
        origin: 'HANDOFF_ACK',
        liveMode: 'HUMAN_REQUESTED',
        expectedControlVersion: 3,
        liveControlVersion: 3,
      }).allowed,
    ).toBe(true);
    expect(
      automatedOutboundPermitted({
        origin: 'HANDOFF_ACK',
        liveMode: 'HUMAN',
        expectedControlVersion: 3,
        liveControlVersion: 3,
      }).allowed,
    ).toBe(false);
  });
});

describe('control commands with memory store', () => {
  const now = new Date('2026-08-30T15:00:00.000Z');

  it('customer handoff then ERP takeover race leaves one owner', async () => {
    const store = memoryStore({
      conversationId: 9,
      mode: 'BOT',
      controlVersion: 1,
      humanLeaseUntil: null,
      humanLastActivityAt: null,
      takeoverSource: null,
      takenOverByUserId: null,
      handoffReason: null,
      handoffRequestedAt: null,
      lastHumanMessageId: null,
      lastBotMessageId: null,
      lastCustomerMessageId: null,
      unreadCount: 0,
    });
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
      resolveUserName: async (id) => (id === 1 ? 'أحمد' : 'منى'),
    });
    const handoff = await requestCustomerHandoff(
      { conversationId: 9, inboundMessageId: 100 },
      deps,
    );
    expect(handoff.ack).toBe(true);
    const a = await takeoverConversationErp({ conversationId: 9, userId: 1 }, deps);
    expect(a.takenOverByUserId).toBe(1);
    await expect(
      takeoverConversationErp({ conversationId: 9, userId: 2 }, deps),
    ).rejects.toBeInstanceOf(HandoffError);
  });
});
