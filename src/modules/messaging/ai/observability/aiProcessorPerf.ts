export type AiProcessorPerfLogInput = {
  event: 'ai_turn_processed' | 'ai_turn_failed' | 'ai_turn_skipped';
  turnId: number;
  conversationId: number;
  anchorInboundMessageId: number;
  latestInboundMessageId: number;
  outboundMessageId?: number | null;
  outboxId?: number | null;
  intent?: string | null;
  duplicate?: boolean;
  skipped?: boolean;
  aiPickupMs: number | null;
  contextLoadMs: number | null;
  burstWaitMs: number | null;
  geminiMs: number | null;
  outputValidationMs: number | null;
  replyPersistMs: number | null;
  outboxEnqueueMs: number | null;
  aiProcessorTotalMs: number;
  messageReceivedToAiStartMs: number | null;
  messageReceivedToReplyEnqueuedMs: number | null;
  errorCode?: string | null;
};

export class AiProcessorPerfTimer {
  private readonly startedAt = performance.now();
  private aiPickupMs: number | null = null;
  private contextLoadMs: number | null = null;
  private burstWaitMs: number | null = null;
  private geminiMs: number | null = null;
  private outputValidationMs: number | null = null;
  private replyPersistMs: number | null = null;
  private outboxEnqueueMs: number | null = null;

  static start(): AiProcessorPerfTimer {
    return new AiProcessorPerfTimer();
  }

  markAiPickupDone(ms: number): void {
    this.aiPickupMs = Math.max(0, Math.round(ms));
  }

  markContextLoadDone(ms: number): void {
    this.contextLoadMs = Math.max(0, Math.round(ms));
  }

  markBurstWaitDone(ms: number): void {
    this.burstWaitMs = Math.max(0, Math.round(ms));
  }

  markGeminiDone(ms: number): void {
    this.geminiMs = Math.max(0, Math.round(ms));
  }

  markOutputValidationDone(ms: number): void {
    this.outputValidationMs = Math.max(0, Math.round(ms));
  }

  markReplyPersistDone(ms: number): void {
    this.replyPersistMs = Math.max(0, Math.round(ms));
  }

  markOutboxEnqueueDone(ms: number): void {
    this.outboxEnqueueMs = Math.max(0, Math.round(ms));
  }

  snapshot(): Omit<
    AiProcessorPerfLogInput,
    | 'event'
    | 'turnId'
    | 'conversationId'
    | 'anchorInboundMessageId'
    | 'latestInboundMessageId'
    | 'outboundMessageId'
    | 'outboxId'
    | 'intent'
    | 'duplicate'
    | 'skipped'
    | 'messageReceivedToAiStartMs'
    | 'messageReceivedToReplyEnqueuedMs'
    | 'errorCode'
  > {
    return {
      aiPickupMs: this.aiPickupMs,
      contextLoadMs: this.contextLoadMs,
      burstWaitMs: this.burstWaitMs,
      geminiMs: this.geminiMs,
      outputValidationMs: this.outputValidationMs,
      replyPersistMs: this.replyPersistMs,
      outboxEnqueueMs: this.outboxEnqueueMs,
      aiProcessorTotalMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
    };
  }
}

export function logAiProcessorPerf(input: AiProcessorPerfLogInput): void {
  console.log(JSON.stringify({ type: 'messaging_ai_processor_perf', ...input }));
}

export function computeMsBetween(isoStart: string | null | undefined, end: Date): number | null {
  if (!isoStart) return null;
  const start = new Date(isoStart).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.round(end.getTime() - start));
}
