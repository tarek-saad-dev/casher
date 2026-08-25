import { describe, it, expect } from 'vitest';
import {
  classifyOutboxGatewayResult,
  GATEWAY_DELIVERY_STATUS_UNKNOWN,
  GATEWAY_IDEMPOTENCY_CONFLICT,
  GATEWAY_IDEMPOTENCY_IN_PROGRESS,
  nextRetryDelayMs,
} from '@/modules/messaging/outbox/workerPolicy';

describe('outbox worker policy', () => {
  it('uses bounded backoff 10s → 30s → 2m → 5m', () => {
    expect(nextRetryDelayMs(1)).toBe(10_000);
    expect(nextRetryDelayMs(2)).toBe(30_000);
    expect(nextRetryDelayMs(3)).toBe(120_000);
    expect(nextRetryDelayMs(4)).toBe(300_000);
    expect(nextRetryDelayMs(9)).toBe(300_000);
  });

  it('retries timeout, unreachable gateway, in-progress, and temporary 5xx', () => {
    expect(classifyOutboxGatewayResult({ sent: false, reason: 'timeout' })).toBe('retry');
    expect(classifyOutboxGatewayResult({ sent: false, reason: 'connection_failed' })).toBe('retry');
    expect(classifyOutboxGatewayResult({ sent: false, reason: 'whatsapp_not_ready' })).toBe('retry');
    expect(
      classifyOutboxGatewayResult({
        sent: false,
        reason: 'remote_error',
        httpStatus: 409,
        code: GATEWAY_IDEMPOTENCY_IN_PROGRESS,
      }),
    ).toBe('retry');
    expect(
      classifyOutboxGatewayResult({ sent: false, reason: 'remote_error', httpStatus: 503 }),
    ).toBe('retry');
  });

  it('fails conflict, unknown delivery, invalid recipient, and does not retry unknown', () => {
    expect(
      classifyOutboxGatewayResult({
        sent: false,
        reason: 'remote_error',
        httpStatus: 409,
        code: GATEWAY_IDEMPOTENCY_CONFLICT,
      }),
    ).toBe('fail');
    expect(
      classifyOutboxGatewayResult({
        sent: false,
        reason: 'whatsapp_not_ready',
        httpStatus: 503,
        code: GATEWAY_DELIVERY_STATUS_UNKNOWN,
      }),
    ).toBe('fail');
    expect(classifyOutboxGatewayResult({ sent: false, reason: 'invalid_phone', httpStatus: 400 })).toBe(
      'fail',
    );
    expect(classifyOutboxGatewayResult({ sent: false, skipped: true, reason: 'invalid_payload' })).toBe(
      'fail',
    );
  });

  it('treats Gateway success as sent, including idempotent replay', () => {
    expect(classifyOutboxGatewayResult({ sent: true })).toBe('sent');
  });
});
