/**
 * Phase 2.1 inbox processor performance marks (console only).
 *
 * workerWakeMs — pending durable → claim started (worker path only)
 * claimDbMs — atomic claim SQL duration
 * conversationDbMs — single-transaction conversation/message SQL
 * clientLookupMs — included in conversationDbMs for new conversations (inline SQL)
 * messageCommitMs — same atomic commit as conversationDbMs in optimized path
 * processorTotalMs — full processInboxMessage duration
 * inboxPersistedToConversationReadyMs — inbox CreatedAt/ReceivedAt → processor completion
 */
export type InboxProcessorPerfSink = {
  markClaimDbDone(claimDbMs: number): void;
  markConversationDbStarted(): void;
  markConversationDbDone(ms: number): void;
  markMessageCommitDone(ms: number): void;
};

export type InboxProcessorPerfLogInput = {
  event: 'inbox_message_processed' | 'inbox_message_failed' | 'inbox_message_skipped';
  inboxId: number;
  conversationId?: number | null;
  messageId?: number | null;
  provider: string;
  providerMessageId: string;
  duplicate: boolean;
  conversationCreated: boolean;
  clientLinked: boolean;
  clientAmbiguous?: boolean;
  workerWakeMs?: number | null;
  claimDbMs: number | null;
  conversationDbMs: number | null;
  clientLookupMs: number | null;
  messageCommitMs: number | null;
  processorTotalMs: number;
  inboxPersistedToConversationReadyMs: number | null;
  sqlRoundTrips?: number | null;
  errorCode?: string | null;
};

export class InboxProcessorPerfTimer implements InboxProcessorPerfSink {
  private readonly processorStartedAt = performance.now();
  private claimDbMs: number | null = null;
  private conversationDbMs: number | null = null;
  private messageCommitMs: number | null = null;

  static start(): InboxProcessorPerfTimer {
    return new InboxProcessorPerfTimer();
  }

  markClaimDbDone(claimDbMs: number): void {
    this.claimDbMs = Math.max(0, Math.round(claimDbMs));
  }

  markConversationDbStarted(): void {
    /* atomic path starts timing in markConversationDbDone */
  }

  markConversationDbDone(ms: number): void {
    this.conversationDbMs = Math.max(0, Math.round(ms));
  }

  markMessageCommitDone(ms: number): void {
    this.messageCommitMs = Math.max(0, Math.round(ms));
  }

  snapshot(): {
    conversationDbMs: number | null;
    clientLookupMs: number | null;
    messageCommitMs: number | null;
    processorTotalMs: number;
    claimDbMs: number | null;
  } {
    return {
      claimDbMs: this.claimDbMs,
      conversationDbMs: this.conversationDbMs,
      clientLookupMs: null,
      messageCommitMs: this.messageCommitMs,
      processorTotalMs: Math.max(0, Math.round(performance.now() - this.processorStartedAt)),
    };
  }
}

export function logInboxProcessorPerf(input: InboxProcessorPerfLogInput): void {
  console.info('[message-inbox-processor-perf]', JSON.stringify({
    ...input,
    at: new Date().toISOString(),
  }));
}

export function computePersistedToReadyMs(
  persistedAtIso: string,
  readyAt: Date,
): number | null {
  const persistedAt = new Date(persistedAtIso);
  if (Number.isNaN(persistedAt.getTime())) return null;
  return Math.max(0, Math.round(readyAt.getTime() - persistedAt.getTime()));
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export function summarizeMs(values: number[]) {
  return {
    count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    samples: values,
  };
}
