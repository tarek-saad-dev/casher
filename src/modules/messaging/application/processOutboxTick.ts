import type {
  GenericWhatsAppMessageInput,
  GenericWhatsAppSendResult,
} from '@/lib/integrations/whatsapp';
import type { OutboxMessageRow } from '../domain/outboxTypes';
import {
  claimPendingBatch,
  markFailed,
  markSent,
  recoverStaleSending,
  scheduleRetry,
} from '../outbox/messageOutboxRepository';
import { parseOutboxMetadataJson } from '../outbox/serializeMetadata';
import {
  classifyOutboxGatewayResult,
  formatGatewayLastError,
  nextRetryDelayMs,
} from '../outbox/workerPolicy';
import {
  evaluateOutboxSendGate,
  stampOutboxCorrelationAfterSend,
} from '@/modules/messaging/handoff/application/outboxSendGate';
import { runWithMessagingJobTenant } from '../tenancy/messagingTenantScope';
import { sendViaTenantChannel } from '../tenancy/transport';

/** Sends one snapshot for the current (row) tenant. Default: the tenant's active channel. */
export type OutboxSend = (input: GenericWhatsAppMessageInput) => Promise<GenericWhatsAppSendResult>;

export type ProcessOutboxTickInput = {
  workerId: string;
  batchSize: number;
  lockTtlMs: number;
  now?: Date;
  send?: OutboxSend;
};

export type ProcessOutboxTickResult = {
  recovered: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
};

async function deliverSnapshot(
  row: OutboxMessageRow,
  send: OutboxSend,
): Promise<GenericWhatsAppSendResult> {
  const metadata = parseOutboxMetadataJson(row.metadataJson) ?? undefined;
  return send({
    phone: row.recipient,
    message: row.content,
    ...(metadata !== undefined ? { metadata } : {}),
    idempotencyKey: row.idempotencyKey,
  });
}

async function settleRow(
  row: OutboxMessageRow,
  result: GenericWhatsAppSendResult,
  now: Date,
): Promise<'sent' | 'retried' | 'failed'> {
  const decision = classifyOutboxGatewayResult(result);
  if (decision === 'sent' && result.sent) {
    await markSent({ id: row.id, providerMessageId: result.messageId });
    await stampOutboxCorrelationAfterSend({
      outboxId: row.id,
      providerMessageId: result.messageId,
    });
    return 'sent';
  }

  const lastError = formatGatewayLastError(result);
  const shouldFail =
    decision === 'fail' || row.attemptCount >= row.maxAttempts || (decision === 'sent' && !result.sent);
  if (shouldFail) {
    await markFailed({
      id: row.id,
      lastError:
        decision === 'fail'
          ? lastError
          : `max_attempts ${lastError}`.trim(),
    });
    return 'failed';
  }

  await scheduleRetry({
    id: row.id,
    nextAttemptAt: new Date(now.getTime() + nextRetryDelayMs(row.attemptCount)),
    lastError,
  });
  return 'retried';
}

type RowOutcome = 'sent' | 'retried' | 'failed' | 'suppressed';

async function processRow(row: OutboxMessageRow, send: OutboxSend, now: Date): Promise<RowOutcome> {
  try {
    const gate = await evaluateOutboxSendGate(row);
    if (!gate.allow) {
      await markFailed({
        id: row.id,
        lastError: `suppressed:${gate.reason}`,
      });
      return 'suppressed';
    }

    const result = await deliverSnapshot(row, send);
    return await settleRow(row, result, now);
  } catch (err) {
    const lastError = err instanceof Error ? err.message : String(err);
    if (row.attemptCount >= row.maxAttempts) {
      await markFailed({ id: row.id, lastError });
      return 'failed';
    }
    await scheduleRetry({
      id: row.id,
      nextAttemptAt: new Date(now.getTime() + nextRetryDelayMs(row.attemptCount)),
      lastError,
    });
    return 'retried';
  }
}

/**
 * One worker tick: recover stale locks, claim a pending batch across tenants, then deliver each
 * row inside its own tenant scope through that tenant's channel. Never a default tenant.
 * Does not re-render templates. Does not run inside Next.js.
 */
export async function processOutboxTick(
  input: ProcessOutboxTickInput,
): Promise<ProcessOutboxTickResult> {
  const now = input.now ?? new Date();
  const send = input.send ?? sendViaTenantChannel;
  const recoveredRows = await recoverStaleSending({ lockTtlMs: input.lockTtlMs });
  const claimed = await claimPendingBatch({
    batchSize: input.batchSize,
    lockedBy: input.workerId,
  });

  const summary: ProcessOutboxTickResult = {
    recovered: recoveredRows.length,
    claimed: claimed.length,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
  };

  for (const row of claimed) {
    if (!row.tenantId) {
      console.error('[messaging-outbox] claimed row without TenantId left locked', { id: row.id });
      continue;
    }
    const outcome = await runWithMessagingJobTenant(row.tenantId, `messaging-outbox:${row.id}`, () =>
      processRow(row, send, now),
    );
    if (outcome === 'suppressed') {
      summary.failed += 1;
      summary.suppressed += 1;
    } else {
      summary[outcome] += 1;
    }
  }

  return summary;
}
