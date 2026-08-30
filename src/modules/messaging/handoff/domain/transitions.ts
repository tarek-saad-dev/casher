import type {
  ConversationControlState,
  ControlTransition,
  HandoffTakeoverSource,
} from './types';

function bump(
  state: ConversationControlState,
  patch: Partial<ConversationControlState>,
  event: Omit<ControlTransition, 'controlVersion'>,
): { state: ConversationControlState; event: ControlTransition } {
  const controlVersion = state.controlVersion + 1;
  return {
    state: { ...state, ...patch, controlVersion },
    event: { ...event, controlVersion },
  };
}

export function leaseUntilIso(now: Date, leaseMinutes: number): string {
  return new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
}

export function applyCustomerHandoffRequest(
  state: ConversationControlState,
  input: { now: Date; leaseMinutes: number; inboundMessageId: number | null },
): { changed: boolean; ack: boolean; state: ConversationControlState; event: ControlTransition | null } {
  if (state.mode === 'HUMAN') {
    return { changed: false, ack: false, state, event: null };
  }
  if (state.mode === 'HUMAN_REQUESTED') {
    return { changed: false, ack: false, state, event: null };
  }
  const until = leaseUntilIso(input.now, input.leaseMinutes);
  const next = bump(
    state,
    {
      mode: 'HUMAN_REQUESTED',
      takeoverSource: 'CUSTOMER_REQUEST',
      takenOverByUserId: null,
      handoffReason: 'customer_explicit_request',
      handoffRequestedAt: input.now.toISOString(),
      humanLeaseUntil: until,
      lastCustomerMessageId: input.inboundMessageId ?? state.lastCustomerMessageId,
    },
    {
      previousMode: state.mode,
      newMode: 'HUMAN_REQUESTED',
      source: 'CUSTOMER_REQUEST',
      reason: 'customer_explicit_request',
      actorUserId: null,
      relatedMessageId: input.inboundMessageId,
    },
  );
  return { changed: true, ack: true, ...next };
}

export function applyErpTakeover(
  state: ConversationControlState,
  input: { now: Date; leaseMinutes: number; userId: number },
): {
  ok: true;
  changed: boolean;
  state: ConversationControlState;
  event: ControlTransition | null;
} | { ok: false; code: 'OWNED_BY_OTHER' } {
  if (state.mode === 'HUMAN' && state.takenOverByUserId != null && state.takenOverByUserId !== input.userId) {
    return { ok: false, code: 'OWNED_BY_OTHER' };
  }
  const until = leaseUntilIso(input.now, input.leaseMinutes);
  if (state.mode === 'HUMAN' && state.takenOverByUserId === input.userId) {
    return {
      ok: true,
      changed: false,
      state: {
        ...state,
        humanLastActivityAt: input.now.toISOString(),
        humanLeaseUntil: until,
      },
      event: null,
    };
  }
  const next = bump(
    state,
    {
      mode: 'HUMAN',
      takeoverSource: 'ERP',
      takenOverByUserId: input.userId,
      humanLastActivityAt: input.now.toISOString(),
      humanLeaseUntil: until,
    },
    {
      previousMode: state.mode,
      newMode: 'HUMAN',
      source: 'ERP',
      reason: 'erp_takeover',
      actorUserId: input.userId,
      relatedMessageId: null,
    },
  );
  return { ok: true, changed: true, ...next };
}

export function applyWhatsAppManualTakeover(
  state: ConversationControlState,
  input: { now: Date; leaseMinutes: number; humanMessageId: number | null },
): { changed: boolean; state: ConversationControlState; event: ControlTransition | null } {
  const until = leaseUntilIso(input.now, input.leaseMinutes);
  if (state.mode === 'HUMAN') {
    return {
      changed: false,
      state: {
        ...state,
        takeoverSource: state.takeoverSource ?? 'WHATSAPP_MANUAL',
        humanLastActivityAt: input.now.toISOString(),
        humanLeaseUntil: until,
        lastHumanMessageId: input.humanMessageId ?? state.lastHumanMessageId,
      },
      event: null,
    };
  }
  const next = bump(
    state,
    {
      mode: 'HUMAN',
      takeoverSource: 'WHATSAPP_MANUAL',
      takenOverByUserId: null,
      humanLastActivityAt: input.now.toISOString(),
      humanLeaseUntil: until,
      lastHumanMessageId: input.humanMessageId ?? state.lastHumanMessageId,
    },
    {
      previousMode: state.mode,
      newMode: 'HUMAN',
      source: 'WHATSAPP_MANUAL',
      reason: 'whatsapp_manual_outbound',
      actorUserId: null,
      relatedMessageId: input.humanMessageId,
    },
  );
  return { changed: true, ...next };
}

export function applyHumanActivityLease(
  state: ConversationControlState,
  input: { now: Date; leaseMinutes: number; humanMessageId: number | null; source: HandoffTakeoverSource },
): ConversationControlState {
  const until = leaseUntilIso(input.now, input.leaseMinutes);
  return {
    ...state,
    humanLastActivityAt: input.now.toISOString(),
    humanLeaseUntil: until,
    lastHumanMessageId: input.humanMessageId ?? state.lastHumanMessageId,
    takeoverSource: state.takeoverSource ?? input.source,
  };
}

/** Customer inbound never extends the human lease. */
export function applyCustomerInbound(
  state: ConversationControlState,
  input: { inboundMessageId: number },
): ConversationControlState {
  return {
    ...state,
    lastCustomerMessageId: input.inboundMessageId,
    unreadCount: state.unreadCount + 1,
  };
}

export function applyReturnToBot(
  state: ConversationControlState,
  input: { actorUserId: number | null; reason: string },
): { changed: boolean; state: ConversationControlState; event: ControlTransition | null } {
  if (state.mode === 'BOT') {
    return { changed: false, state, event: null };
  }
  const next = bump(
    state,
    {
      mode: 'BOT',
      takeoverSource: null,
      takenOverByUserId: null,
      humanLeaseUntil: null,
      humanLastActivityAt: null,
      handoffReason: null,
    },
    {
      previousMode: state.mode,
      newMode: 'BOT',
      source: input.actorUserId != null ? 'ERP_RETURN' : 'LEASE_EXPIRED',
      reason: input.reason,
      actorUserId: input.actorUserId,
      relatedMessageId: null,
    },
  );
  return { changed: true, ...next };
}

export function isLeaseExpired(state: ConversationControlState, now: Date): boolean {
  if (state.mode !== 'HUMAN' && state.mode !== 'HUMAN_REQUESTED') return false;
  if (!state.humanLeaseUntil) return true;
  return new Date(state.humanLeaseUntil).getTime() <= now.getTime();
}
