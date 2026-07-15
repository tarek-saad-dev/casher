/**
 * Development-only nested timing for booking Phase 3.
 * Aggregate one log per parent stage — never per barber/row.
 */
export type StageTimer = {
  mark: (name: string) => void;
  set: (name: string, ms: number) => void;
  finish: (prefix: string, extra?: Record<string, unknown>) => Record<string, number>;
};

export function createStageTimer(enabled = process.env.NODE_ENV !== 'production'): StageTimer {
  const t0 = Date.now();
  let last = t0;
  const stages: Record<string, number> = {};
  return {
    mark(name: string) {
      if (!enabled) return;
      const now = Date.now();
      stages[name] = now - last;
      last = now;
    },
    set(name: string, ms: number) {
      if (!enabled) return;
      stages[name] = Math.max(0, Math.round(ms));
    },
    finish(prefix: string, extra: Record<string, unknown> = {}) {
      const totalMs = Date.now() - t0;
      if (enabled) {
        console.log(prefix, { ...stages, totalMs, ...extra });
      }
      return { ...stages, totalMs };
    },
  };
}
