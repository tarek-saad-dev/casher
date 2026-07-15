/**
 * Development-only request timing (measurement / Phase 1 perf audits).
 * No-ops meaningfully in production (no Server-Timing, no console).
 */
export type DevTimer = {
  mark: (stage: string) => void;
  /** Absolute ms since timer start for a stage (overwrites). */
  setAbsolute: (stage: string, ms: number) => void;
  snapshot: () => Record<string, number>;
  log: (prefix: string, extra?: Record<string, unknown>) => void;
  serverTimingHeader: () => string;
  requestId: string;
  totalMs: () => number;
};

export function createDevTimer(requestIdPrefix = 'req'): DevTimer {
  const requestId = `${requestIdPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const t0 = Date.now();
  let last = t0;
  const stages: Record<string, number> = {};

  return {
    requestId,
    mark(stage: string) {
      const now = Date.now();
      stages[stage] = now - last;
      last = now;
    },
    setAbsolute(stage: string, ms: number) {
      stages[stage] = Math.max(0, Math.round(ms));
    },
    snapshot() {
      return { ...stages, totalMs: Date.now() - t0 };
    },
    totalMs() {
      return Date.now() - t0;
    },
    log(prefix: string, extra: Record<string, unknown> = {}) {
      if (process.env.NODE_ENV === 'production') return;
      console.log(prefix, { requestId, ...stages, totalMs: Date.now() - t0, ...extra });
    },
    serverTimingHeader() {
      if (process.env.NODE_ENV === 'production') return '';
      const parts = Object.entries(stages).map(
        ([k, v]) => `${k};dur=${v}`,
      );
      parts.push(`total;dur=${Date.now() - t0}`);
      return parts.join(', ');
    },
  };
}
