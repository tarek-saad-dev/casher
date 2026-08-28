export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
export const DEFAULT_AI_BURST_DEBOUNCE_MS = 250;
export const DEFAULT_AI_CONTEXT_MAX_MESSAGES = 10;
export const DEFAULT_AI_MODEL_TIMEOUT_MS = 12_000;
export const DEFAULT_AI_BATCH_SIZE = 1;
export const DEFAULT_AI_IDLE_MIN_MS = 5;
export const DEFAULT_AI_IDLE_MAX_MS = 100;
export const DEFAULT_AI_RECENT_ACTIVE_MS = 2_000;
export const DEFAULT_AI_STALE_PROCESSING_MS = 120_000;
export const DEFAULT_AI_MAX_RETRIES = 3;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getAiConfig(env: NodeJS.ProcessEnv = process.env) {
  const burstMs = parsePositiveInt(env.AI_BURST_DEBOUNCE_MS, DEFAULT_AI_BURST_DEBOUNCE_MS);
  return {
    geminiApiKey: String(env.GEMINI_API_KEY ?? '').trim(),
    geminiModel: String(env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL,
    burstDebounceMs: Math.min(400, Math.max(150, burstMs)),
    contextMaxMessages: parsePositiveInt(env.AI_CONTEXT_MAX_MESSAGES, DEFAULT_AI_CONTEXT_MAX_MESSAGES),
    modelTimeoutMs: parsePositiveInt(env.AI_MODEL_TIMEOUT_MS, DEFAULT_AI_MODEL_TIMEOUT_MS),
    enabled: Boolean(String(env.GEMINI_API_KEY ?? '').trim()),
  };
}

export function getAiWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...getAiConfig(env),
    idleMinMs: parsePositiveInt(env.MESSAGING_AI_IDLE_MIN_MS, DEFAULT_AI_IDLE_MIN_MS),
    idleMaxMs: parsePositiveInt(env.MESSAGING_AI_IDLE_MAX_MS, DEFAULT_AI_IDLE_MAX_MS),
    batchSize: parsePositiveInt(env.MESSAGING_AI_BATCH_SIZE, DEFAULT_AI_BATCH_SIZE),
    staleProcessingMs: parsePositiveInt(
      env.MESSAGING_AI_STALE_PROCESSING_MS,
      DEFAULT_AI_STALE_PROCESSING_MS,
    ),
    recentActiveMs: parsePositiveInt(
      env.MESSAGING_AI_RECENT_ACTIVE_MS,
      DEFAULT_AI_RECENT_ACTIVE_MS,
    ),
    maxRetries: parsePositiveInt(env.MESSAGING_AI_MAX_RETRIES, DEFAULT_AI_MAX_RETRIES),
  };
}
