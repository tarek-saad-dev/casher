import { createGeminiModelClient } from '../model/geminiModelClient';
import {
  claimPendingAiTurnBatch,
  recoverStaleAiProcessing,
} from '../infra/aiTurnRepository';
import { processAiTurn } from './processAiTurn';
import { runWithMessagingJobTenant } from '../../tenancy/messagingTenantScope';

export type ProcessAiTickInput = {
  batchSize: number;
  staleProcessingMs: number;
};

export type ProcessAiTickResult = {
  recoveredRequeued: number;
  recoveredFailed: number;
  claimed: number;
  processed: number;
  failed: number;
  skipped: number;
};

export async function processAiTick(input: ProcessAiTickInput): Promise<ProcessAiTickResult> {
  const recovery = await recoverStaleAiProcessing({ staleMs: input.staleProcessingMs });
  const workerId = `ai-${process.pid}`;
  const claimed = await claimPendingAiTurnBatch({
    batchSize: input.batchSize,
    workerId,
    staleMs: input.staleProcessingMs,
  });

  const summary: ProcessAiTickResult = {
    recoveredRequeued: recovery.requeued,
    recoveredFailed: recovery.failed,
    claimed: claimed.length,
    processed: 0,
    failed: 0,
    skipped: 0,
  };

  const modelClient = createGeminiModelClient();

  for (const turn of claimed) {
    if (!turn.tenantId) {
      console.error('[messaging-ai] claimed turn without TenantId; skipping', { turnId: turn.turnId });
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await runWithMessagingJobTenant(turn.tenantId, `messaging-ai:${turn.turnId}`, () =>
        processAiTurn(turn, { modelClient }),
      );
      if (result.skipped) summary.skipped += 1;
      else summary.processed += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
