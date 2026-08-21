/**
 * Booking Phase B2.5 — optional SQL/read telemetry for critical public reads.
 * Logs only (requestId + timings + queryCount). Does not alter response contracts.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { sql } from '@/lib/db';

export type PublicBookingReadTelemetryStore = {
  queryCount: number;
  dbMs: number;
  availabilityMs: number;
};

const als = new AsyncLocalStorage<PublicBookingReadTelemetryStore>();
let queryPatchInstalled = false;

function ensureQueryCountPatch(): void {
  if (queryPatchInstalled) return;
  queryPatchInstalled = true;
  const proto = sql.Request.prototype as {
    query: (this: sql.Request, ...args: unknown[]) => Promise<unknown>;
  };
  const orig = proto.query;
  proto.query = function patchedQuery(this: sql.Request, ...args: unknown[]) {
    const store = als.getStore();
    if (!store) {
      return orig.apply(this, args as Parameters<typeof orig>);
    }
    const t0 = Date.now();
    const result = orig.apply(this, args as Parameters<typeof orig>);
    return Promise.resolve(result).then(
      (value) => {
        store.queryCount += 1;
        store.dbMs += Math.max(0, Date.now() - t0);
        return value;
      },
      (err) => {
        store.queryCount += 1;
        store.dbMs += Math.max(0, Date.now() - t0);
        throw err;
      },
    );
  };
}

export function getPublicBookingReadTelemetry(): PublicBookingReadTelemetryStore | null {
  return als.getStore() ?? null;
}

export function setAvailabilityMs(ms: number): void {
  const store = als.getStore();
  if (store) store.availabilityMs = Math.max(0, Math.round(ms));
}

/**
 * Run a critical-read body under SQL query/dbMs accumulation.
 * Nested calls reuse the outer store.
 */
export async function runWithPublicBookingReadTelemetry<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; telemetry: PublicBookingReadTelemetryStore }> {
  ensureQueryCountPatch();
  const existing = als.getStore();
  if (existing) {
    const result = await fn();
    return { result, telemetry: existing };
  }
  const store: PublicBookingReadTelemetryStore = {
    queryCount: 0,
    dbMs: 0,
    availabilityMs: 0,
  };
  const result = await als.run(store, fn);
  return { result, telemetry: store };
}
