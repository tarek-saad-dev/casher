/**
 * Phase 3B.1 — Browser UI invalidation for availability changes.
 * Not authoritative — server cache invalidation remains source of truth.
 */

export const AVAILABILITY_CHANGED_EVENT = 'availability:changed';

export type AvailabilityChangedDetail = {
  businessDate: string;
  branchId?: number;
  employeeIds?: number[];
  source?: 'create' | 'cancel' | 'manual';
  atMs?: number;
};

const CHANNEL_NAME = 'pos-availability-changed';

let lastEmitAt = 0;
const DEBOUNCE_MS = 400;

type Listener = (detail: AvailabilityChangedDetail) => void;
const localListeners = new Set<Listener>();

function canUseWindow(): boolean {
  return typeof window !== 'undefined';
}

function notifyLocal(detail: AvailabilityChangedDetail): void {
  for (const cb of localListeners) {
    try {
      cb(detail);
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Emit after successful create/cancel. Debounced to avoid refresh loops. */
export function emitAvailabilityChanged(detail: AvailabilityChangedDetail): void {
  const now = Date.now();
  if (now - lastEmitAt < DEBOUNCE_MS) return;
  lastEmitAt = now;

  const payload: AvailabilityChangedDetail = {
    ...detail,
    atMs: now,
  };

  notifyLocal(payload);

  if (!canUseWindow()) return;

  try {
    window.dispatchEvent(
      new CustomEvent(AVAILABILITY_CHANGED_EVENT, { detail: payload }),
    );
  } catch {
    /* ignore */
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      ch.postMessage(payload);
      ch.close();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to in-process listeners + same-tab CustomEvent + cross-tab BroadcastChannel.
 * Callback should re-fetch when businessDate matches.
 */
export function subscribeAvailabilityChanged(callback: Listener): () => void {
  let lastHandledAt = 0;
  const handle = (detail: AvailabilityChangedDetail | null | undefined) => {
    if (!detail?.businessDate) return;
    const at = detail.atMs ?? Date.now();
    if (at - lastHandledAt < DEBOUNCE_MS) return;
    lastHandledAt = at;
    callback(detail);
  };

  const localWrapped: Listener = (d) => handle(d);
  localListeners.add(localWrapped);

  let onWindow: ((ev: Event) => void) | null = null;
  let channel: BroadcastChannel | null = null;

  if (canUseWindow()) {
    onWindow = (ev: Event) => {
      const ce = ev as CustomEvent<AvailabilityChangedDetail>;
      handle(ce.detail);
    };
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, onWindow);

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (ev) => {
          handle(ev.data as AvailabilityChangedDetail);
        };
      }
    } catch {
      channel = null;
    }
  }

  return () => {
    localListeners.delete(localWrapped);
    if (canUseWindow() && onWindow) {
      window.removeEventListener(AVAILABILITY_CHANGED_EVENT, onWindow);
    }
    try {
      channel?.close();
    } catch {
      /* ignore */
    }
  };
}

/** Test helper */
export function __resetAvailabilityChangedDebounceForTests(): void {
  lastEmitAt = 0;
}
