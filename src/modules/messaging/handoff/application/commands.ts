import { getConversationById } from '@/modules/messaging/conversation/infra/botConversationRepository';
import {
  getHumanHandoffLeaseMinutes,
  isHumanHandoffActiveForPhone,
  isHumanHandoffV1Enabled,
} from '../featureFlag';
import {
  applyCustomerHandoffRequest,
  applyCustomerInbound,
  applyErpTakeover,
  applyHumanActivityLease,
  applyReturnToBot,
  applyWhatsAppManualTakeover,
  isLeaseExpired,
} from '../domain/transitions';
import { logHandoffEvent } from '../observability';
import type { ConversationControlState } from '../domain/types';
import { HandoffError } from './errors';
import type { ConversationControlStore } from './store';
import { sqlConversationControlStore } from '../infra/sqlControlStore';

export type ControlCommandDeps = {
  store: ConversationControlStore;
  now: () => Date;
  leaseMinutes: () => number;
  /** Master flag only (ignore canary). Prefer enabledForPhone. */
  enabled: () => boolean;
  enabledForPhone: (phone: string | null | undefined) => boolean;
  resolveUserName?: (userId: number) => Promise<string | null>;
  resolvePhone?: (conversationId: number) => Promise<string | null>;
};

const defaultDeps: ControlCommandDeps = {
  store: sqlConversationControlStore,
  now: () => new Date(),
  leaseMinutes: () => getHumanHandoffLeaseMinutes(),
  enabled: () => isHumanHandoffV1Enabled(),
  enabledForPhone: (phone) => isHumanHandoffActiveForPhone(phone),
  resolvePhone: async (conversationId) => {
    const conv = await getConversationById(conversationId);
    return conv?.phone ?? null;
  },
};

async function isEnabledForConversation(
  conversationId: number,
  deps: ControlCommandDeps,
): Promise<boolean> {
  if (!deps.enabled()) return false;
  const phone = deps.resolvePhone
    ? await deps.resolvePhone(conversationId)
    : null;
  return deps.enabledForPhone(phone);
}

export function withControlDeps(over: Partial<ControlCommandDeps>): ControlCommandDeps {
  return { ...defaultDeps, ...over };
}

async function requireState(
  store: ConversationControlStore,
  conversationId: number,
): Promise<ConversationControlState> {
  const live = await store.get(conversationId);
  if (!live) throw new HandoffError('المحادثة غير موجودة', 'NOT_FOUND', 404);
  return live;
}

export async function requestCustomerHandoff(
  input: { conversationId: number; inboundMessageId: number | null },
  deps: ControlCommandDeps = defaultDeps,
): Promise<{ ack: boolean; state: ConversationControlState }> {
  if (!(await isEnabledForConversation(input.conversationId, deps))) {
    const state = await requireState(deps.store, input.conversationId);
    return { ack: false, state };
  }
  const live = await requireState(deps.store, input.conversationId);
  const applied = applyCustomerHandoffRequest(live, {
    now: deps.now(),
    leaseMinutes: deps.leaseMinutes(),
    inboundMessageId: input.inboundMessageId,
  });
  if (!applied.changed) {
    return { ack: false, state: live };
  }
  const saved = await deps.store.persist({
    previous: live,
    next: applied.state,
    event: applied.event,
  });
  if (!saved.ok) {
    if (saved.code === 'VERSION_CONFLICT') {
      const again = await requireState(deps.store, input.conversationId);
      return { ack: false, state: again };
    }
    throw new HandoffError('المحادثة غير موجودة', 'NOT_FOUND', 404);
  }
  logHandoffEvent('human_handoff_requested', {
    conversationId: input.conversationId,
    controlVersion: applied.state.controlVersion,
  });
  logHandoffEvent('conversation_control_changed', {
    conversationId: input.conversationId,
    previousMode: live.mode,
    newMode: applied.state.mode,
    controlVersion: applied.state.controlVersion,
    source: 'CUSTOMER_REQUEST',
  });
  return { ack: true, state: applied.state };
}

export async function takeoverConversationErp(
  input: { conversationId: number; userId: number },
  deps: ControlCommandDeps = defaultDeps,
): Promise<ConversationControlState> {
  if (!(await isEnabledForConversation(input.conversationId, deps))) {
    throw new HandoffError('التحويل للموظف غير مفعّل', 'FEATURE_DISABLED', 403);
  }
  const live = await requireState(deps.store, input.conversationId);
  const applied = applyErpTakeover(live, {
    now: deps.now(),
    leaseMinutes: deps.leaseMinutes(),
    userId: input.userId,
  });
  if (!applied.ok) {
    const name = live.takenOverByUserId
      ? (await deps.resolveUserName?.(live.takenOverByUserId)) ?? null
      : null;
    throw new HandoffError(
      name ? `مستلمة بواسطة ${name}` : 'المحادثة مستلمة بواسطة موظف آخر',
      'OWNED_BY_OTHER',
      409,
      name,
    );
  }
  if (!applied.changed) {
    await deps.store.persistFields(applied.state);
    logHandoffEvent('human_lease_extended', {
      conversationId: input.conversationId,
      source: 'ERP',
      userId: input.userId,
    });
    return applied.state;
  }
  const saved = await deps.store.persist({
    previous: live,
    next: applied.state,
    event: applied.event,
  });
  if (!saved.ok) {
    const again = await requireState(deps.store, input.conversationId);
    if (again.mode === 'HUMAN' && again.takenOverByUserId != null && again.takenOverByUserId !== input.userId) {
      const name = (await deps.resolveUserName?.(again.takenOverByUserId)) ?? null;
      throw new HandoffError(
        name ? `مستلمة بواسطة ${name}` : 'المحادثة مستلمة بواسطة موظف آخر',
        'OWNED_BY_OTHER',
        409,
        name,
      );
    }
    throw new HandoffError('تعذر استلام المحادثة', 'VERSION_CONFLICT', 409);
  }
  logHandoffEvent('human_takeover_erp', {
    conversationId: input.conversationId,
    userId: input.userId,
    controlVersion: applied.state.controlVersion,
    previousMode: live.mode,
  });
  logHandoffEvent('conversation_control_changed', {
    conversationId: input.conversationId,
    previousMode: live.mode,
    newMode: applied.state.mode,
    controlVersion: applied.state.controlVersion,
    source: 'ERP',
  });
  return applied.state;
}

export async function returnConversationToBot(
  input: { conversationId: number; actorUserId: number | null; reason: string },
  deps: ControlCommandDeps = defaultDeps,
): Promise<{ state: ConversationControlState; changed: boolean }> {
  if (!(await isEnabledForConversation(input.conversationId, deps))) {
    throw new HandoffError('التحويل للموظف غير مفعّل', 'FEATURE_DISABLED', 403);
  }
  const live = await requireState(deps.store, input.conversationId);
  const applied = applyReturnToBot(live, {
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
  if (!applied.changed) {
    return { state: live, changed: false };
  }
  const saved = await deps.store.persist({
    previous: live,
    next: applied.state,
    event: applied.event,
  });
  if (!saved.ok) {
    throw new HandoffError('تعذر إرجاع المحادثة', saved.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VERSION_CONFLICT', saved.code === 'NOT_FOUND' ? 404 : 409);
  }
  logHandoffEvent('conversation_returned_to_bot', {
    conversationId: input.conversationId,
    previousMode: live.mode,
    reason: input.reason,
    controlVersion: applied.state.controlVersion,
  });
  logHandoffEvent('conversation_control_changed', {
    conversationId: input.conversationId,
    previousMode: live.mode,
    newMode: 'BOT',
    controlVersion: applied.state.controlVersion,
    source: input.actorUserId != null ? 'ERP_RETURN' : 'LEASE_EXPIRED',
  });
  return { state: applied.state, changed: true };
}

export async function recordCustomerInboundActivity(
  input: { conversationId: number; inboundMessageId: number },
  deps: ControlCommandDeps = defaultDeps,
): Promise<void> {
  const live = await deps.store.get(input.conversationId);
  if (!live) return;
  const next = applyCustomerInbound(live, { inboundMessageId: input.inboundMessageId });
  await deps.store.persistFields(next);
}

export async function recordHumanActivity(
  input: {
    conversationId: number;
    humanMessageId: number | null;
    source: 'ERP' | 'WHATSAPP_MANUAL';
  },
  deps: ControlCommandDeps = defaultDeps,
): Promise<ConversationControlState> {
  const live = await requireState(deps.store, input.conversationId);
  const next = applyHumanActivityLease(live, {
    now: deps.now(),
    leaseMinutes: deps.leaseMinutes(),
    humanMessageId: input.humanMessageId,
    source: input.source,
  });
  await deps.store.persistFields(next);
  logHandoffEvent('human_lease_extended', {
    conversationId: input.conversationId,
    source: input.source,
  });
  return next;
}

export async function applyWhatsAppManualControl(
  input: { conversationId: number; humanMessageId: number | null },
  deps: ControlCommandDeps = defaultDeps,
): Promise<{ changed: boolean; state: ConversationControlState }> {
  if (!(await isEnabledForConversation(input.conversationId, deps))) {
    const live = await requireState(deps.store, input.conversationId);
    return { changed: false, state: live };
  }
  const live = await requireState(deps.store, input.conversationId);
  const applied = applyWhatsAppManualTakeover(live, {
    now: deps.now(),
    leaseMinutes: deps.leaseMinutes(),
    humanMessageId: input.humanMessageId,
  });
  if (!applied.changed) {
    await deps.store.persistFields(applied.state);
    logHandoffEvent('human_lease_extended', {
      conversationId: input.conversationId,
      source: 'WHATSAPP_MANUAL',
    });
    return { changed: false, state: applied.state };
  }
  const saved = await deps.store.persist({
    previous: live,
    next: applied.state,
    event: applied.event,
  });
  if (!saved.ok) {
    const again = await requireState(deps.store, input.conversationId);
    return { changed: false, state: again };
  }
  logHandoffEvent('human_takeover_whatsapp', {
    conversationId: input.conversationId,
    controlVersion: applied.state.controlVersion,
    previousMode: live.mode,
  });
  logHandoffEvent('conversation_control_changed', {
    conversationId: input.conversationId,
    previousMode: live.mode,
    newMode: 'HUMAN',
    controlVersion: applied.state.controlVersion,
    source: 'WHATSAPP_MANUAL',
  });
  return { changed: true, state: applied.state };
}

export async function markInboxRead(
  conversationId: number,
  deps: ControlCommandDeps = defaultDeps,
): Promise<void> {
  await requireState(deps.store, conversationId);
  await deps.store.markRead(conversationId);
}

export { isLeaseExpired };
