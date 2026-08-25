export const DEFAULT_OUTBOX_POLL_MS = 2000;
export const DEFAULT_OUTBOX_BATCH_SIZE = 10;
export const DEFAULT_OUTBOX_LOCK_TTL_MS = 300_000;

/** Bounded backoff after failed attempts: 10s → 30s → 2m → 5m */
export const OUTBOX_RETRY_BACKOFF_MS = [10_000, 30_000, 120_000, 300_000] as const;

export const GATEWAY_IDEMPOTENCY_IN_PROGRESS = 'IDEMPOTENCY_IN_PROGRESS';
export const GATEWAY_IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT';
export const GATEWAY_DELIVERY_STATUS_UNKNOWN = 'DELIVERY_STATUS_UNKNOWN';

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getOutboxWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    pollMs: parsePositiveInt(env.MESSAGE_OUTBOX_POLL_MS, DEFAULT_OUTBOX_POLL_MS),
    batchSize: parsePositiveInt(env.MESSAGE_OUTBOX_BATCH_SIZE, DEFAULT_OUTBOX_BATCH_SIZE),
    lockTtlMs: parsePositiveInt(env.MESSAGE_OUTBOX_LOCK_TTL_MS, DEFAULT_OUTBOX_LOCK_TTL_MS),
  };
}

export function nextRetryDelayMs(attemptCount: number): number {
  const n = Math.max(1, Math.floor(attemptCount));
  const index = Math.min(n, OUTBOX_RETRY_BACKOFF_MS.length) - 1;
  return OUTBOX_RETRY_BACKOFF_MS[index];
}

export type OutboxDeliveryDecision = 'sent' | 'retry' | 'fail';

export function classifyOutboxGatewayResult(result: {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  httpStatus?: number;
  code?: string;
}): OutboxDeliveryDecision {
  if (result.sent) return 'sent';

  const code = typeof result.code === 'string' ? result.code.trim() : '';
  if (code === GATEWAY_IDEMPOTENCY_CONFLICT || code === GATEWAY_DELIVERY_STATUS_UNKNOWN) {
    return 'fail';
  }
  if (code === GATEWAY_IDEMPOTENCY_IN_PROGRESS) {
    return 'retry';
  }

  if (result.skipped) {
    if (
      result.reason === 'missing_phone' ||
      result.reason === 'invalid_payload' ||
      result.reason === 'missing_customer_name'
    ) {
      return 'fail';
    }
    return 'retry';
  }

  switch (result.reason) {
    case 'timeout':
    case 'connection_failed':
    case 'whatsapp_not_ready':
    case 'queued':
      return 'retry';
    case 'invalid_phone':
    case 'not_registered':
      return 'fail';
    case 'remote_error':
    case 'failed':
    case 'invalid_response': {
      const status = result.httpStatus;
      if (status != null && status >= 500 && status < 600) return 'retry';
      return 'fail';
    }
    default:
      return 'fail';
  }
}

export function formatGatewayLastError(result: {
  reason?: string;
  code?: string;
  error?: string;
  httpStatus?: number;
}): string {
  const parts = [
    result.code,
    result.reason,
    result.httpStatus != null ? `http=${result.httpStatus}` : null,
    result.error,
  ].filter(Boolean);
  return parts.join(' ').slice(0, 4000) || 'gateway_failure';
}
