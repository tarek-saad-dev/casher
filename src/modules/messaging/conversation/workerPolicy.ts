export const DEFAULT_INBOX_IDLE_MIN_MS = 25;
export const DEFAULT_INBOX_IDLE_MAX_MS = 150;
export const DEFAULT_INBOX_BATCH_SIZE = 1;
export const DEFAULT_INBOX_STALE_PROCESSING_MS = 120_000;
export const DEFAULT_INBOX_RECENT_ACTIVE_MS = 2_000;

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getInboxWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    idleMinMs: parsePositiveInt(env.MESSAGING_INBOX_IDLE_MIN_MS, DEFAULT_INBOX_IDLE_MIN_MS),
    idleMaxMs: parsePositiveInt(env.MESSAGING_INBOX_IDLE_MAX_MS, DEFAULT_INBOX_IDLE_MAX_MS),
    batchSize: parsePositiveInt(env.MESSAGING_INBOX_BATCH_SIZE, DEFAULT_INBOX_BATCH_SIZE),
    staleProcessingMs: parsePositiveInt(
      env.MESSAGING_INBOX_STALE_PROCESSING_MS,
      DEFAULT_INBOX_STALE_PROCESSING_MS,
    ),
    recentActiveMs: parsePositiveInt(
      env.MESSAGING_INBOX_RECENT_ACTIVE_MS,
      DEFAULT_INBOX_RECENT_ACTIVE_MS,
    ),
  };
}

export function nextIdleDelayMs(
  idleMinMs: number,
  idleMaxMs: number,
  consecutiveIdleTicks: number,
  recentlyActive: boolean,
): number {
  if (recentlyActive) return 0;
  const min = Math.max(1, idleMinMs);
  const max = Math.max(min, idleMaxMs);
  if (consecutiveIdleTicks <= 0) return 0;
  const exponent = Math.min(consecutiveIdleTicks, 4);
  const delay = min * 2 ** (exponent - 1);
  return Math.min(max, delay);
}
