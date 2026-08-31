import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConversationControlState } from '@/modules/messaging/handoff/domain/types';
import {
  applyCustomerInbound,
  applyErpTakeover,
  applyHumanActivityLease,
  applyReturnToBot,
  applyWhatsAppManualTakeover,
} from '@/modules/messaging/handoff/domain/transitions';
import { classifyFromMeEvent } from '@/modules/messaging/handoff/domain/classify';
import {
  applyWhatsAppManualControl,
  returnConversationToBot,
  takeoverConversationErp,
  withControlDeps,
} from '@/modules/messaging/handoff/application/commands';
import type { ConversationControlStore } from '@/modules/messaging/handoff/application/store';
import { evaluateOutboxSendGate } from '@/modules/messaging/handoff/application/outboxSendGate';
import type { OutboxMessageRow } from '@/modules/messaging/domain/outboxTypes';

function botState(over: Partial<ConversationControlState> = {}): ConversationControlState {
  return {
    conversationId: 1,
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
    ...over,
  };
}

function memoryStore(seed: ConversationControlState): ConversationControlStore {
  let state = { ...seed };
  const claims = new Set<string>();
  const events: unknown[] = [];
  return {
    async get() {
      return { ...state };
    },
    async persist(input) {
      events.push(input.event);
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
    async listExpired(now) {
      if (
        (state.mode === 'HUMAN' || state.mode === 'HUMAN_REQUESTED') &&
        state.humanLeaseUntil &&
        new Date(state.humanLeaseUntil).getTime() <= now.getTime()
      ) {
        return [{ conversationId: state.conversationId, mode: state.mode }];
      }
      return [];
    },
    async tryResumeClaim(input) {
      if (claims.has(input.claimKey)) return { claimed: false };
      claims.add(input.claimKey);
      return { claimed: true };
    },
    _events: events,
    _state: () => state,
  } as ConversationControlStore & { _events: unknown[]; _state: () => ConversationControlState };
}

const getConversationControl = vi.fn();
const insertOutboundCorrelation = vi.fn();
const findCorrelationByProviderMessageId = vi.fn();
const hasPendingUnstampedCorrelation = vi.fn();

vi.mock('@/modules/messaging/handoff/infra/conversationControlRepository', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/modules/messaging/handoff/infra/conversationControlRepository')
  >();
  return {
    ...actual,
    getConversationControl: (...args: unknown[]) => getConversationControl(...args),
  };
});

vi.mock('@/modules/messaging/handoff/infra/outboundCorrelationRepository', () => ({
  insertOutboundCorrelation: (...args: unknown[]) => insertOutboundCorrelation(...args),
  stampOutboundCorrelation: vi.fn(),
  findCorrelationByProviderMessageId: (...args: unknown[]) =>
    findCorrelationByProviderMessageId(...args),
  hasPendingUnstampedCorrelation: (...args: unknown[]) =>
    hasPendingUnstampedCorrelation(...args),
}));

vi.mock('@/modules/messaging/handoff/featureFlag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/messaging/handoff/featureFlag')>();
  return {
    ...actual,
    isHumanHandoffActiveForPhone: () => true,
    isHumanHandoffV1Enabled: () => true,
  };
});

const scheduleAiTurn = vi.fn();
vi.mock('@/modules/messaging/ai/application/scheduleAiTurn', () => ({
  scheduleAiTurn: (...args: unknown[]) => scheduleAiTurn(...args),
}));

vi.mock('@/modules/messaging/conversation/infra/botConversationRepository', () => ({
  getConversationById: vi.fn(async () => ({ phone: '201555000000' })),
}));

function outboxRow(over: Partial<OutboxMessageRow> = {}): OutboxMessageRow {
  return {
    id: 99,
    channel: 'whatsapp',
    recipient: '201555000000',
    templateKey: '',
    content: 'bot reply',
    metadataJson: JSON.stringify({
      source: 'ai-receptionist',
      origin: 'BOT',
      conversationId: 1,
      expectedControlVersion: 1,
    }),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: null,
    lockedAt: null,
    lockedBy: null,
    providerMessageId: null,
    lastError: null,
    branchId: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    sentAt: null,
    failedAt: null,
    idempotencyKey: 'test-key',
    ...over,
  };
}

describe('instant manual takeover hardening', () => {
  const now = new Date('2026-08-30T15:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    insertOutboundCorrelation.mockResolvedValue(undefined);
    findCorrelationByProviderMessageId.mockResolvedValue(null);
    hasPendingUnstampedCorrelation.mockResolvedValue(false);
  });

  it('1. bot outbound fromMe=true does NOT trigger takeover classification', () => {
    expect(
      classifyFromMeEvent({
        providerMessageId: 'wamid.bot',
        known: {
          providerMessageId: 'wamid.bot',
          origin: 'BOT',
          phone: '2010',
          createdAt: now.toISOString(),
          stamped: true,
        },
        pendingUnstampedForPhone: false,
      }).kind,
    ).toBe('AUTOMATED');
  });

  it('2-3. unknown manual fromMe triggers BOT→HUMAN with WHATSAPP_MANUAL', async () => {
    const store = memoryStore(botState({ conversationId: 9 }));
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
    });
    const result = await applyWhatsAppManualControl(
      { conversationId: 9, humanMessageId: 55 },
      deps,
    );
    expect(result.changed).toBe(true);
    expect(result.state.mode).toBe('HUMAN');
    expect(result.state.takeoverSource).toBe('WHATSAPP_MANUAL');
    expect(result.state.controlVersion).toBe(2);
  });

  it('4. manual takeover sets lease ≈ 15 minutes', async () => {
    const store = memoryStore(botState({ conversationId: 9 }));
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
    });
    const result = await applyWhatsAppManualControl(
      { conversationId: 9, humanMessageId: 55 },
      deps,
    );
    expect(new Date(result.state.humanLeaseUntil!).getTime()).toBe(
      now.getTime() + 15 * 60_000,
    );
  });

  it('5. second manual human message extends lease another 15 minutes', async () => {
    const first = applyWhatsAppManualTakeover(botState(), {
      now,
      leaseMinutes: 15,
      humanMessageId: 1,
    });
    const later = new Date(now.getTime() + 10 * 60_000);
    const second = applyWhatsAppManualTakeover(first.state, {
      now: later,
      leaseMinutes: 15,
      humanMessageId: 2,
    });
    expect(second.changed).toBe(false);
    expect(new Date(second.state.humanLeaseUntil!).getTime()).toBe(
      later.getTime() + 15 * 60_000,
    );
  });

  it('6. ERP human activity extends lease', () => {
    const taken = applyErpTakeover(botState(), { now, leaseMinutes: 15, userId: 7 });
    if (!taken.ok) throw new Error('expected ok');
    const later = new Date(now.getTime() + 8 * 60_000);
    const extended = applyHumanActivityLease(taken.state, {
      now: later,
      leaseMinutes: 15,
      humanMessageId: 40,
      source: 'ERP',
    });
    expect(new Date(extended.humanLeaseUntil!).getTime()).toBe(
      later.getTime() + 15 * 60_000,
    );
  });

  it('7. customer message does NOT extend human lease', () => {
    const taken = applyErpTakeover(botState(), { now, leaseMinutes: 15, userId: 7 });
    if (!taken.ok) throw new Error('expected ok');
    const afterCustomer = applyCustomerInbound(taken.state, { inboundMessageId: 99 });
    expect(afterCustomer.humanLeaseUntil).toBe(taken.state.humanLeaseUntil);
  });

  it('10. queued AI outbound is suppressed at provider-send gate after takeover', async () => {
    getConversationControl.mockResolvedValue(
      botState({ conversationId: 1, mode: 'HUMAN', controlVersion: 2 }),
    );
    const gate = await evaluateOutboxSendGate(outboxRow());
    expect(gate.allow).toBe(false);
    if (gate.allow) return;
    expect(gate.reason).toBeTruthy();
  });

  it('11. stale control version is rejected at provider-send gate', async () => {
    getConversationControl.mockResolvedValue(
      botState({ conversationId: 1, mode: 'BOT', controlVersion: 3 }),
    );
    const gate = await evaluateOutboxSendGate(
      outboxRow({
        metadataJson: JSON.stringify({
          source: 'ai-receptionist',
          origin: 'BOT',
          conversationId: 1,
          expectedControlVersion: 1,
        }),
      }),
    );
    expect(gate.allow).toBe(false);
  });

  it('12. matching control version allows provider-send gate', async () => {
    getConversationControl.mockResolvedValue(
      botState({ conversationId: 1, mode: 'BOT', controlVersion: 2 }),
    );
    const gate = await evaluateOutboxSendGate(
      outboxRow({
        metadataJson: JSON.stringify({
          source: 'ai-receptionist',
          origin: 'BOT',
          conversationId: 1,
          expectedControlVersion: 2,
        }),
      }),
    );
    expect(gate.allow).toBe(true);
  });

  it('13. ERP takeover bumps control version for stale AI rejection', async () => {
    const store = memoryStore(botState({ conversationId: 9, controlVersion: 1 }));
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
    });
    const state = await takeoverConversationErp({ conversationId: 9, userId: 3 }, deps);
    expect(state.mode).toBe('HUMAN');
    expect(state.controlVersion).toBe(2);
    getConversationControl.mockResolvedValue(state);
    const gate = await evaluateOutboxSendGate(
      outboxRow({
        metadataJson: JSON.stringify({
          source: 'ai-receptionist',
          origin: 'BOT',
          conversationId: 9,
          expectedControlVersion: 1,
        }),
      }),
    );
    expect(gate.allow).toBe(false);
  });

  it('16. explicit ERP return-to-bot restores BOT immediately', async () => {
    const store = memoryStore(
      botState({ conversationId: 9, mode: 'HUMAN', controlVersion: 2, takenOverByUserId: 1 }),
    );
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
    });
    const result = await returnConversationToBot(
      { conversationId: 9, actorUserId: 1, reason: 'erp_return' },
      deps,
    );
    expect(result.changed).toBe(true);
    expect(result.state.mode).toBe('BOT');
    expect(result.state.humanLeaseUntil).toBeNull();
  });

  it('17. lease expiry restores BOT', async () => {
    const expiredAt = new Date(now.getTime() - 60_000);
    const store = memoryStore(
      botState({
        conversationId: 9,
        mode: 'HUMAN',
        controlVersion: 2,
        humanLeaseUntil: expiredAt.toISOString(),
        humanLastActivityAt: expiredAt.toISOString(),
      }),
    );
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
    });
    const result = await returnConversationToBot(
      { conversationId: 9, actorUserId: null, reason: 'lease_expired' },
      deps,
    );
    expect(result.changed).toBe(true);
    expect(result.state.mode).toBe('BOT');
  });

  it('18. lease expiry with no unanswered customer turn is silent', async () => {
    scheduleAiTurn.mockClear();
    const expiredAt = new Date(now.getTime() - 60_000);
    const store = memoryStore(
      botState({
        conversationId: 9,
        mode: 'HUMAN',
        controlVersion: 2,
        humanLeaseUntil: expiredAt.toISOString(),
      }),
    );
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
    });
    const returned = await returnConversationToBot(
      { conversationId: 9, actorUserId: null, reason: 'lease_expired' },
      deps,
    );
    expect(returned.changed).toBe(true);
    expect(returned.state.mode).toBe('BOT');
    expect(scheduleAiTurn).not.toHaveBeenCalled();
  });

  it('20. duplicate manual takeover does not bump control version again', async () => {
    const store = memoryStore(botState({ conversationId: 9 }));
    const deps = withControlDeps({
      store,
      now: () => now,
      leaseMinutes: () => 15,
      enabled: () => true,
      enabledForPhone: () => true,
      resolvePhone: async () => '201555000000',
    });
    const first = await applyWhatsAppManualControl(
      { conversationId: 9, humanMessageId: 1 },
      deps,
    );
    const second = await applyWhatsAppManualControl(
      { conversationId: 9, humanMessageId: 2 },
      deps,
    );
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.state.controlVersion).toBe(first.state.controlVersion);
  });
});
