import 'server-only';

import { sql } from '@/lib/db';
import {
  resolveInvoiceTargetRecalculationScope,
  type TargetRecalcScope,
} from './employee-target-recalc-scope';
import { enqueueEmployeeTargetRecalculations } from './employee-target-recalc-enqueue.service';
import { tryProcessEnqueuedTargetRecalcs } from './employee-target-recalc-process.service';

/**
 * Shared integration: enqueue scopes inside the invoice transaction.
 * Caller must invoke tryProcessAfterInvoiceCommit after successful commit.
 */
export async function enqueueTargetRecalcFromInvoiceSnapshots(params: {
  transaction: sql.Transaction;
  beforeSnapshot?: unknown | null;
  afterSnapshot?: unknown | null;
  reason: string;
  sourceType: string;
  sourceRef: string;
}): Promise<TargetRecalcScope[]> {
  const scopes = resolveInvoiceTargetRecalculationScope({
    beforeSnapshot: params.beforeSnapshot,
    afterSnapshot: params.afterSnapshot,
    reasons: [params.reason],
  });
  if (scopes.length === 0) return [];

  await enqueueEmployeeTargetRecalculations({
    transaction: params.transaction,
    scopes,
    reason: params.reason,
    sourceType: params.sourceType,
    sourceRef: params.sourceRef.slice(0, 100),
  });
  return scopes;
}

export async function tryProcessAfterInvoiceCommit(params: {
  scopes: TargetRecalcScope[];
  actorUserId: number | null;
}): Promise<void> {
  if (params.scopes.length === 0) return;
  await tryProcessEnqueuedTargetRecalcs({
    scopes: params.scopes,
    actorUserId: params.actorUserId,
  });
}
