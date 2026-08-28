/**
 * Phase 1.1 — lightweight webhook ingest timing (console only, no DB writes).
 * Single-line JSON logs for aggregators. Never log phone/text/raw payload.
 */

export type InboxWebhookPerfSink = {
  markAuthCompleted(): void;
  markValidationCompleted(): void;
  markDbIngestStarted(): void;
  markDbIngestCompleted(): void;
};

export type InboxWebhookPerfLogInput = {
  provider: string;
  providerMessageId: string;
  inboxId?: number | null;
  duplicate: boolean;
  httpStatus: number;
  errorCode?: string | null;
  adapterCorrelation?: Record<string, string | number | null>;
  timer: InboxWebhookPerfTimer;
};

export class InboxWebhookPerfTimer implements InboxWebhookPerfSink {
  private readonly requestReceivedAt = performance.now();
  private authCompletedAt?: number;
  private validationCompletedAt?: number;
  private dbIngestStartedAt?: number;
  private dbIngestCompletedAt?: number;

  static start(): InboxWebhookPerfTimer {
    return new InboxWebhookPerfTimer();
  }

  markAuthCompleted(): void {
    if (this.authCompletedAt == null) {
      this.authCompletedAt = performance.now();
    }
  }

  markValidationCompleted(): void {
    if (this.validationCompletedAt == null) {
      this.validationCompletedAt = performance.now();
    }
  }

  markDbIngestStarted(): void {
    if (this.dbIngestStartedAt == null) {
      this.dbIngestStartedAt = performance.now();
    }
  }

  markDbIngestCompleted(): void {
    if (this.dbIngestCompletedAt == null) {
      this.dbIngestCompletedAt = performance.now();
    }
  }

  snapshot(responseReturnedAt = performance.now()): {
    validationMs: number;
    dbIngestMs: number | null;
    totalWebhookMs: number;
  } {
    const validationEnd = this.validationCompletedAt ?? responseReturnedAt;
    const dbStart = this.dbIngestStartedAt;
    const dbEnd = this.dbIngestCompletedAt;

    return {
      validationMs: Math.max(0, Math.round(validationEnd - this.requestReceivedAt)),
      dbIngestMs:
        dbStart != null && dbEnd != null ? Math.max(0, Math.round(dbEnd - dbStart)) : null,
      totalWebhookMs: Math.max(0, Math.round(responseReturnedAt - this.requestReceivedAt)),
    };
  }
}

/** Extract optional bot/adapter timing fields from rawPayload for log correlation only. */
export function extractAdapterCorrelation(
  rawPayload: unknown,
): Record<string, string | number | null> | undefined {
  if (rawPayload == null || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return undefined;
  }

  const payload = rawPayload as Record<string, unknown>;
  const candidates = [
    'correlationId',
    'botReceivedAt',
    'botWebhookSentAt',
    'adapterReceivedAt',
    'adapterMs',
    'botInboxListenerMs',
    'botWebhookPostMs',
  ] as const;

  const out: Record<string, string | number | null> = {};
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === 'string' || typeof value === 'number') {
      out[key] = value;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function logInboxWebhookPerf(input: InboxWebhookPerfLogInput): void {
  const responseReturnedAt = performance.now();
  const timing = input.timer.snapshot(responseReturnedAt);

  console.info(
    '[message-inbox-webhook-perf]',
    JSON.stringify({
      event: 'inbox_webhook_ingest',
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      inboxId: input.inboxId ?? null,
      duplicate: input.duplicate,
      httpStatus: input.httpStatus,
      errorCode: input.errorCode ?? null,
      validationMs: timing.validationMs,
      dbIngestMs: timing.dbIngestMs,
      totalWebhookMs: timing.totalWebhookMs,
      adapterCorrelation: input.adapterCorrelation ?? null,
      at: new Date().toISOString(),
    }),
  );
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}
