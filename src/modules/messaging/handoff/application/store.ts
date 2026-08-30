import type { ConversationControlState, ControlTransition } from '../domain/types';

export type PersistControlResult =
  | { ok: true }
  | { ok: false; code: 'VERSION_CONFLICT' | 'NOT_FOUND' };

export type ConversationControlStore = {
  get(conversationId: number): Promise<ConversationControlState | null>;
  persist(input: {
    previous: ConversationControlState;
    next: ConversationControlState;
    event: ControlTransition | null;
  }): Promise<PersistControlResult>;
  persistFields(next: ConversationControlState): Promise<void>;
  markRead(conversationId: number): Promise<void>;
  listExpired(now: Date): Promise<ConversationControlState[]>;
  tryResumeClaim(input: {
    conversationId: number;
    latestCustomerMessageId: number;
    claimKey: string;
  }): Promise<{ claimed: boolean }>;
};

export async function persistWithRetry(
  store: ConversationControlStore,
  conversationId: number,
  apply: (
    live: ConversationControlState,
  ) => { next: ConversationControlState; event: ControlTransition | null; versioned: boolean },
): Promise<
  | { ok: true; previous: ConversationControlState; next: ConversationControlState }
  | { ok: false; code: 'NOT_FOUND' | 'VERSION_CONFLICT'; live: ConversationControlState | null }
> {
  const live = await store.get(conversationId);
  if (!live) return { ok: false, code: 'NOT_FOUND', live: null };
  const applied = apply(live);
  if (applied.versioned) {
    const saved = await store.persist({ previous: live, next: applied.next, event: applied.event });
    if (!saved.ok) return { ok: false, code: saved.code, live };
    return { ok: true, previous: live, next: applied.next };
  }
  await store.persistFields(applied.next);
  return { ok: true, previous: live, next: applied.next };
}
