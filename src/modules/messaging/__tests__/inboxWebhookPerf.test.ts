import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractAdapterCorrelation,
  InboxWebhookPerfTimer,
  logInboxWebhookPerf,
  percentile,
} from '@/modules/messaging/inbox/observability/inboxWebhookPerf';

describe('inboxWebhookPerf', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes validationMs, dbIngestMs, and totalWebhookMs from marks', () => {
    const timer = InboxWebhookPerfTimer.start();
    timer.markAuthCompleted();
    timer.markValidationCompleted();
    timer.markDbIngestStarted();
    timer.markDbIngestCompleted();

    const timing = timer.snapshot(performance.now() + 5);
    expect(timing.validationMs).toBeGreaterThanOrEqual(0);
    expect(timing.dbIngestMs).toBeGreaterThanOrEqual(0);
    expect(timing.totalWebhookMs).toBeGreaterThanOrEqual(timing.validationMs);
  });

  it('extracts optional adapter correlation from rawPayload without persisting it', () => {
    expect(
      extractAdapterCorrelation({
        correlationId: 'bot-trace-1',
        botReceivedAt: '2026-08-28T07:00:00.000Z',
        adapterMs: 12,
        phone: 'should-not-log',
      }),
    ).toEqual({
      correlationId: 'bot-trace-1',
      botReceivedAt: '2026-08-28T07:00:00.000Z',
      adapterMs: 12,
    });
  });

  it('emits structured perf log with provider + providerMessageId correlation', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const timer = InboxWebhookPerfTimer.start();
    timer.markAuthCompleted();
    timer.markValidationCompleted();
    timer.markDbIngestStarted();
    timer.markDbIngestCompleted();

    logInboxWebhookPerf({
      timer,
      provider: 'whatsapp-web',
      providerMessageId: 'phase1-perf-001',
      inboxId: 42,
      duplicate: false,
      httpStatus: 201,
      adapterCorrelation: { correlationId: 'bot-trace-1' },
    });

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0]?.[1]));
    expect(payload.event).toBe('inbox_webhook_ingest');
    expect(payload.provider).toBe('whatsapp-web');
    expect(payload.providerMessageId).toBe('phase1-perf-001');
    expect(payload.validationMs).toBeTypeOf('number');
    expect(payload.dbIngestMs).toBeTypeOf('number');
    expect(payload.totalWebhookMs).toBeTypeOf('number');
    expect(payload.adapterCorrelation).toEqual({ correlationId: 'bot-trace-1' });
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('text');
  });

  it('calculates percentiles', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
    expect(percentile([], 50)).toBeNull();
  });
});
