/**
 * Booking V2 B9.6 — revision-aware warm matrix context (branch / settings / roster).
 * Separate from live FreeMask availability. Not write authority.
 */

import { createSingleFlight } from '@/lib/booking/cache/singleFlight';

export type WarmBranchRef = {
  branchId: number;
  branchCode: string;
  timezone: string;
};

export type WarmSettingsSlice = {
  branchId: number;
  timezone: string;
  slotIntervalMinutes: number;
  maxBookingDaysAhead: number;
  minNoticeMinutes: number;
  currency: string;
};

export type WarmMatrixContextEntry = {
  branch: WarmBranchRef;
  settings: WarmSettingsSlice;
  /** Public bookable emp IDs for asOfDate (roster). */
  rosterByAsOf: Map<string, number[]>;
  builtAtMs: number;
  /** Bumped when settings/branch/roster invalidate. */
  contextRevision: number;
};

const CONTEXT_TTL_MS = 60_000;
const flight = createSingleFlight<WarmMatrixContextEntry>();

type Store = {
  byCode: Map<string, WarmMatrixContextEntry>;
  globalRevision: number;
};

function getStore(): Store {
  const g = globalThis as typeof globalThis & {
    __bookingV2WarmMatrixContext?: Store;
  };
  if (!g.__bookingV2WarmMatrixContext) {
    g.__bookingV2WarmMatrixContext = {
      byCode: new Map(),
      globalRevision: 0,
    };
  }
  return g.__bookingV2WarmMatrixContext;
}

export function bumpWarmMatrixContextRevision(reason?: string): void {
  const s = getStore();
  s.globalRevision += 1;
  s.byCode.clear();
  if (reason) {
    // lightweight observability
    console.info(
      '[booking-warm-context]',
      JSON.stringify({ event: 'invalidate', reason, rev: s.globalRevision }),
    );
  }
}

export function getWarmMatrixContextRevision(): number {
  return getStore().globalRevision;
}

export async function getOrLoadWarmMatrixContext(args: {
  branchCode: string;
  asOfDate: string;
  load: () => Promise<{
    branch: WarmBranchRef;
    settings: WarmSettingsSlice;
    /**
     * undefined = do not write rosterByAsOf for this asOfDate
     * (specific-emp loads must not poison later branch-roster reads with []).
     */
    rosterEmpIds?: number[];
  }>;
}): Promise<{
  entry: WarmMatrixContextEntry;
  cacheHit: boolean;
  loadMs: number;
}> {
  const code = args.branchCode.trim().toUpperCase();
  const store = getStore();
  const existing = store.byCode.get(code);
  const now = Date.now();

  if (
    existing &&
    now - existing.builtAtMs < CONTEXT_TTL_MS &&
    existing.contextRevision === store.globalRevision
  ) {
    if (!existing.rosterByAsOf.has(args.asOfDate)) {
      // roster miss for this asOf — refresh via flight
    } else {
      return { entry: existing, cacheHit: true, loadMs: 0 };
    }
  }

  const t0 = performance.now();
  const { value } = await flight.do(`ctx:${code}:${args.asOfDate}`, async () => {
    const again = store.byCode.get(code);
    if (
      again &&
      Date.now() - again.builtAtMs < CONTEXT_TTL_MS &&
      again.contextRevision === store.globalRevision &&
      again.rosterByAsOf.has(args.asOfDate)
    ) {
      return again;
    }
    const loaded = await args.load();
    const prev = store.byCode.get(code);
    const rosterByAsOf = new Map(prev?.rosterByAsOf ?? []);
    // Only persist roster when the loader actually fetched it.
    if (loaded.rosterEmpIds !== undefined) {
      rosterByAsOf.set(args.asOfDate, loaded.rosterEmpIds);
    }
    const entry: WarmMatrixContextEntry = {
      branch: loaded.branch,
      settings: loaded.settings,
      rosterByAsOf,
      builtAtMs: Date.now(),
      contextRevision: store.globalRevision,
    };
    store.byCode.set(code, entry);
    return entry;
  });

  return {
    entry: value,
    cacheHit: false,
    loadMs: performance.now() - t0,
  };
}

/** Soft memo for Emp×date-range revision SQL (cross-instance source still SQL). */
const REV_SOFT_TTL_MS = 250;
const revFlight = createSingleFlight<{
  byKey: Map<string, import('@/lib/booking/projection/AvailabilityRevision').AvailabilityRevisionParts>;
  queryCount: number;
  dbMs: number;
  fromCache: boolean;
}>();

type RevMemo = {
  expiresAt: number;
  byKey: Map<
    string,
    import('@/lib/booking/projection/AvailabilityRevision').AvailabilityRevisionParts
  >;
  queryCount: number;
  dbMs: number;
};

function getRevMemoStore(): Map<string, RevMemo> {
  const g = globalThis as typeof globalThis & {
    __bookingV2RevSoftMemo?: Map<string, RevMemo>;
  };
  if (!g.__bookingV2RevSoftMemo) g.__bookingV2RevSoftMemo = new Map();
  return g.__bookingV2RevSoftMemo;
}

export async function loadAvailabilityRevisionBatchSoft(args: {
  employeeIds: number[];
  fromBusinessDate: string;
  toBusinessDate: string;
}): Promise<{
  byKey: Map<
    string,
    import('@/lib/booking/projection/AvailabilityRevision').AvailabilityRevisionParts
  >;
  queryCount: number;
  dbMs: number;
  softHit: boolean;
}> {
  const empKey = [...args.employeeIds].sort((a, b) => a - b).join(',');
  const key = `${empKey}|${args.fromBusinessDate}|${args.toBusinessDate}`;
  const store = getRevMemoStore();
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return {
      byKey: hit.byKey,
      queryCount: 0,
      dbMs: 0,
      softHit: true,
    };
  }

  const { value } = await revFlight.do(key, async () => {
    const again = store.get(key);
    if (again && again.expiresAt > Date.now()) {
      return {
        byKey: again.byKey,
        queryCount: 0,
        dbMs: 0,
        fromCache: true,
      };
    }
    const { getAvailabilityRevisionSqlStore } = await import(
      '@/lib/booking/cache/AvailabilityRevisionSqlStore'
    );
    const batch = await getAvailabilityRevisionSqlStore().loadBatch(args);
    store.set(key, {
      expiresAt: Date.now() + REV_SOFT_TTL_MS,
      byKey: batch.byKey,
      queryCount: batch.queryCount,
      dbMs: batch.dbMs,
    });
    // Bound memo size
    if (store.size > 64) {
      const first = store.keys().next().value;
      if (first) store.delete(first);
    }
    return {
      byKey: batch.byKey,
      queryCount: batch.queryCount,
      dbMs: batch.dbMs,
      fromCache: false,
    };
  });

  return {
    byKey: value.byKey,
    queryCount: value.queryCount,
    dbMs: value.dbMs,
    softHit: value.fromCache,
  };
}

export function clearAvailabilityRevisionSoftMemo(): void {
  getRevMemoStore().clear();
}

export function __resetWarmMatrixContextForTests(): void {
  const g = globalThis as typeof globalThis & {
    __bookingV2WarmMatrixContext?: Store;
    __bookingV2RevSoftMemo?: Map<string, RevMemo>;
  };
  g.__bookingV2WarmMatrixContext = undefined;
  g.__bookingV2RevSoftMemo = undefined;
}
