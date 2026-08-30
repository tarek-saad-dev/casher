import { describe, expect, it } from 'vitest';
import {
  getHumanHandoffLeaseMinutes,
  isHumanHandoffV1Enabled,
} from '@/modules/messaging/handoff/featureFlag';
import {
  aiIsSuppressed,
  botAutomatedSendAllowed,
  HANDOFF_ACK_AR,
} from '@/modules/messaging/handoff/domain/types';
import type { ConversationControlState } from '@/modules/messaging/handoff/domain/types';
import {
  applyCustomerHandoffRequest,
  applyCustomerInbound,
  applyErpTakeover,
  applyHumanActivityLease,
  applyReturnToBot,
  applyWhatsAppManualTakeover,
  isLeaseExpired,
} from '@/modules/messaging/handoff/domain/transitions';
import {
  classifyFromMeEvent,
  findLatestUnansweredCustomerTurn,
  resumeClaimKey,
} from '@/modules/messaging/handoff/domain/classify';

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

describe('HUMAN_HANDOFF_V1 flag', () => {
  it('is off by default', () => {
    expect(isHumanHandoffV1Enabled({})).toBe(false);
    expect(isHumanHandoffV1Enabled({ HUMAN_HANDOFF_V1: 'false' })).toBe(false);
    expect(isHumanHandoffV1Enabled({ HUMAN_HANDOFF_V1: 'true' })).toBe(true);
    expect(getHumanHandoffLeaseMinutes({})).toBe(15);
  });
});

describe('conversation control transitions', () => {
  const now = new Date('2026-08-30T15:00:00.000Z');

  it('1. BOT → HUMAN_REQUESTED on explicit request and bumps version', () => {
    const r = applyCustomerHandoffRequest(botState(), { now, leaseMinutes: 15, inboundMessageId: 10 });
    expect(r.changed).toBe(true);
    expect(r.ack).toBe(true);
    expect(r.state.mode).toBe('HUMAN_REQUESTED');
    expect(r.state.controlVersion).toBe(2);
    expect(r.state.takeoverSource).toBe('CUSTOMER_REQUEST');
    expect(HANDOFF_ACK_AR).toMatch(/الاستقبال/);
    expect(HANDOFF_ACK_AR).not.toMatch(/Human Agent|AI mode|BOT mode/);
  });

  it('2-3. repeated request does not re-ack', () => {
    const first = applyCustomerHandoffRequest(botState(), { now, leaseMinutes: 15, inboundMessageId: 10 });
    const second = applyCustomerHandoffRequest(first.state, { now, leaseMinutes: 15, inboundMessageId: 11 });
    expect(second.ack).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.state.controlVersion).toBe(2);
  });

  it('4. ERP takeover BOT → HUMAN', () => {
    const r = applyErpTakeover(botState(), { now, leaseMinutes: 15, userId: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.mode).toBe('HUMAN');
    expect(r.state.takenOverByUserId).toBe(7);
    expect(r.state.takeoverSource).toBe('ERP');
  });

  it('5. ERP takeover HUMAN_REQUESTED → HUMAN', () => {
    const req = applyCustomerHandoffRequest(botState(), { now, leaseMinutes: 15, inboundMessageId: 1 });
    const r = applyErpTakeover(req.state, { now, leaseMinutes: 15, userId: 7 });
    expect(r.ok && r.state.mode).toBe('HUMAN');
  });

  it('6. two ERP users: second cannot steal', () => {
    const a = applyErpTakeover(botState(), { now, leaseMinutes: 15, userId: 1 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = applyErpTakeover(a.state, { now, leaseMinutes: 15, userId: 2 });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.code).toBe('OWNED_BY_OTHER');
  });

  it('7. human ERP activity extends lease; 12. customer does not', () => {
    const taken = applyErpTakeover(botState(), { now, leaseMinutes: 15, userId: 1 });
    if (!taken.ok) throw new Error('expected ok');
    const later = new Date(now.getTime() + 10 * 60_000);
    const extended = applyHumanActivityLease(taken.state, {
      now: later,
      leaseMinutes: 15,
      humanMessageId: 50,
      source: 'ERP',
    });
    expect(new Date(extended.humanLeaseUntil!).getTime()).toBe(later.getTime() + 15 * 60_000);
    const afterCustomer = applyCustomerInbound(extended, { inboundMessageId: 51 });
    expect(afterCustomer.humanLeaseUntil).toBe(extended.humanLeaseUntil);
    expect(afterCustomer.unreadCount).toBe(extended.unreadCount + 1);
  });

  it('8-9. WhatsApp manual takeover and lease extend', () => {
    const first = applyWhatsAppManualTakeover(botState(), { now, leaseMinutes: 15, humanMessageId: 9 });
    expect(first.changed).toBe(true);
    expect(first.state.mode).toBe('HUMAN');
    expect(first.state.takeoverSource).toBe('WHATSAPP_MANUAL');
    const later = new Date(now.getTime() + 5 * 60_000);
    const again = applyWhatsAppManualTakeover(first.state, { now: later, leaseMinutes: 15, humanMessageId: 12 });
    expect(again.changed).toBe(false);
    expect(again.state.mode).toBe('HUMAN');
    expect(new Date(again.state.humanLeaseUntil!).getTime()).toBe(later.getTime() + 15 * 60_000);
  });

  it('13-14. HUMAN and HUMAN_REQUESTED suppress AI', () => {
    expect(aiIsSuppressed('HUMAN')).toBe(true);
    expect(aiIsSuppressed('HUMAN_REQUESTED')).toBe(true);
    expect(aiIsSuppressed('BOT')).toBe(false);
    expect(botAutomatedSendAllowed('BOT')).toBe(true);
    expect(botAutomatedSendAllowed('HUMAN')).toBe(false);
  });

  it('16. manual return HUMAN → BOT', () => {
    const taken = applyErpTakeover(botState(), { now, leaseMinutes: 15, userId: 1 });
    if (!taken.ok) throw new Error('expected ok');
    const back = applyReturnToBot(taken.state, { actorUserId: 1, reason: 'erp_return' });
    expect(back.changed).toBe(true);
    expect(back.state.mode).toBe('BOT');
    expect(back.state.takenOverByUserId).toBeNull();
    expect(back.state.humanLeaseUntil).toBeNull();
  });

  it('19-20. expired HUMAN and HUMAN_REQUESTED can return to BOT', () => {
    const human = applyErpTakeover(botState(), { now, leaseMinutes: 15, userId: 1 });
    if (!human.ok) throw new Error('expected ok');
    expect(isLeaseExpired(human.state, new Date(now.getTime() + 16 * 60_000))).toBe(true);
    expect(isLeaseExpired(human.state, new Date(now.getTime() + 5 * 60_000))).toBe(false);
    const req = applyCustomerHandoffRequest(botState(), { now, leaseMinutes: 15, inboundMessageId: 1 });
    expect(isLeaseExpired(req.state, new Date(now.getTime() + 16 * 60_000))).toBe(true);
  });
});

describe('fromMe classification', () => {
  it('10. known bot ProviderMessageID is not human', () => {
    expect(
      classifyFromMeEvent({
        providerMessageId: 'wamid.bot',
        known: {
          providerMessageId: 'wamid.bot',
          origin: 'BOT',
          phone: '2010',
          createdAt: new Date().toISOString(),
          stamped: true,
        },
        pendingUnstampedForPhone: false,
      }).kind,
    ).toBe('AUTOMATED');
  });

  it('11. known ERP human outbound is HUMAN_ERP', () => {
    expect(
      classifyFromMeEvent({
        providerMessageId: 'wamid.erp',
        known: {
          providerMessageId: 'wamid.erp',
          origin: 'HUMAN_ERP',
          phone: '2010',
          createdAt: new Date().toISOString(),
          stamped: true,
        },
        pendingUnstampedForPhone: false,
      }).kind,
    ).toBe('HUMAN_ERP');
  });

  it('unknown fromMe is WHATSAPP_MANUAL', () => {
    expect(
      classifyFromMeEvent({
        providerMessageId: 'wamid.phone',
        known: null,
        pendingUnstampedForPhone: false,
      }).kind,
    ).toBe('WHATSAPP_MANUAL');
  });

  it('pending unstamped same-phone send is AMBIGUOUS', () => {
    expect(
      classifyFromMeEvent({
        providerMessageId: 'wamid.race',
        known: null,
        pendingUnstampedForPhone: true,
      }).kind,
    ).toBe('AMBIGUOUS');
  });
});

describe('unanswered turn + resume claim', () => {
  it('17. no unanswered after last outbound', () => {
    expect(
      findLatestUnansweredCustomerTurn([
        { messageId: 1, direction: 'inbound', origin: 'CUSTOMER', occurredAt: '2026-08-30T10:00:00.000Z' },
        { messageId: 2, direction: 'outbound', origin: 'HANDOFF_ACK', occurredAt: '2026-08-30T10:00:01.000Z' },
      ]),
    ).toBeNull();
  });

  it('18/21. unanswered after human leaves', () => {
    expect(
      findLatestUnansweredCustomerTurn([
        { messageId: 1, direction: 'inbound', origin: 'CUSTOMER', occurredAt: 't1' },
        { messageId: 2, direction: 'outbound', origin: 'HUMAN_ERP', occurredAt: 't2' },
        { messageId: 3, direction: 'inbound', origin: 'CUSTOMER', occurredAt: 't3' },
        { messageId: 4, direction: 'inbound', origin: 'CUSTOMER', occurredAt: 't4' },
      ]),
    ).toBe(4);
  });

  it('22-23. one claim key per latest customer message', () => {
    expect(resumeClaimKey(9, 44)).toBe('resume:9:44');
    expect(resumeClaimKey(9, 44)).toBe(resumeClaimKey(9, 44));
  });

  it('25-26. stale ControlVersion blocks BOT; matching version allows', async () => {
    const { automatedOutboundPermitted } = await import(
      '@/modules/messaging/handoff/domain/classify'
    );
    expect(
      automatedOutboundPermitted({
        origin: 'BOT',
        liveMode: 'HUMAN',
        expectedControlVersion: 1,
        liveControlVersion: 2,
      }).allowed,
    ).toBe(false);
    expect(
      automatedOutboundPermitted({
        origin: 'BOT',
        liveMode: 'BOT',
        expectedControlVersion: 4,
        liveControlVersion: 4,
      }).allowed,
    ).toBe(true);
  });

  it('27. HANDOFF_ACK permitted in HUMAN_REQUESTED once-version', async () => {
    const { automatedOutboundPermitted } = await import(
      '@/modules/messaging/handoff/domain/classify'
    );
    expect(
      automatedOutboundPermitted({
        origin: 'HANDOFF_ACK',
        liveMode: 'HUMAN_REQUESTED',
        expectedControlVersion: 2,
        liveControlVersion: 2,
      }).allowed,
    ).toBe(true);
  });
});
