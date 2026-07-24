import 'server-only';

import { generateEmployeeDailyTargets } from './employee-daily-target-generation.service';
import {
  claimTargetRecalcRequests,
  finalizeTargetRecalcFailure,
  finalizeTargetRecalcSuccess,
  listTargetRecalcRequests,
  type TargetRecalcRequestRow,
} from './employee-target-recalc.repository';
import {
  sanitizeRecalcError,
  type TargetRecalcRequestStatus,
} from './employee-target-recalc.schemas';
import {
  enqueueEmployeeTargetRecalculationsStandalone,
  type EnqueueResultItem,
} from './employee-target-recalc-enqueue.service';
import type { TargetRecalcScope } from './employee-target-recalc-scope';

export interface ProcessRecalcResultItem {
  requestId: number;
  empId: number;
  workDate: string;
  processingVersion: number;
  outcome: 'completed' | 'pending_newer' | 'failed';
  error?: string;
}

export interface ProcessEmployeeTargetRecalcRequestsResult {
  claimed: number;
  completed: number;
  pendingNewer: number;
  failed: number;
  items: ProcessRecalcResultItem[];
}

/**
 * Claim pending/failed requests, run generateEmployeeDailyTargets per row,
 * then version-aware finalize. Heavy generate is outside the claim TX.
 */
export async function processEmployeeTargetRecalcRequests(params: {
  requestIds?: number[] | null;
  workDate?: string;
  empIds?: number[] | null;
  maxRequests?: number;
  actorUserId: number | null;
}): Promise<ProcessEmployeeTargetRecalcRequestsResult> {
  const maxRequests = params.maxRequests ?? 50;
  const claimed = await claimTargetRecalcRequests({
    workDate: params.workDate,
    empIds: params.empIds,
    requestIds: params.requestIds,
    maxRequests,
  });

  const items: ProcessRecalcResultItem[] = [];
  let completed = 0;
  let pendingNewer = 0;
  let failed = 0;

  for (const row of claimed) {
    const processingVersion = row.requestedVersion;
    try {
      await generateEmployeeDailyTargets({
        workDate: row.workDate,
        branchId: row.branchId,
        empIds: [row.empId],
        generatedByUserId: params.actorUserId,
      });
      const outcome = await finalizeTargetRecalcSuccess({
        requestId: row.id,
        processingVersion,
      });
      if (outcome === 'completed') completed += 1;
      else pendingNewer += 1;
      items.push({
        requestId: row.id,
        empId: row.empId,
        workDate: row.workDate,
        processingVersion,
        outcome,
      });
    } catch (err) {
      const safe = sanitizeRecalcError(err);
      await finalizeTargetRecalcFailure({ requestId: row.id, errorSafe: safe });
      failed += 1;
      items.push({
        requestId: row.id,
        empId: row.empId,
        workDate: row.workDate,
        processingVersion,
        outcome: 'failed',
        error: safe,
      });
    }
  }

  return {
    claimed: claimed.length,
    completed,
    pendingNewer,
    failed,
    items,
  };
}

/**
 * Post-commit helper: best-effort process for just-enqueued scopes.
 * Never throws to the invoice caller — log failures only.
 */
export async function tryProcessEnqueuedTargetRecalcs(params: {
  scopes: TargetRecalcScope[];
  actorUserId: number | null;
}): Promise<ProcessEmployeeTargetRecalcRequestsResult | null> {
  if (params.scopes.length === 0) return null;
  try {
    const byDateBranch = new Map<string, { workDate: string; branchId: number; empIds: number[] }>();
    for (const s of params.scopes) {
      const key = `${s.workDate}|${s.branchId}`;
      const entry = byDateBranch.get(key) ?? {
        workDate: s.workDate,
        branchId: s.branchId,
        empIds: [],
      };
      entry.empIds.push(s.empId);
      byDateBranch.set(key, entry);
    }
    const merged: ProcessEmployeeTargetRecalcRequestsResult = {
      claimed: 0,
      completed: 0,
      pendingNewer: 0,
      failed: 0,
      items: [],
    };
    for (const group of byDateBranch.values()) {
      const r = await processEmployeeTargetRecalcRequests({
        workDate: group.workDate,
        empIds: [...new Set(group.empIds)],
        maxRequests: Math.min(50, group.empIds.length + 5),
        actorUserId: params.actorUserId,
      });
      merged.claimed += r.claimed;
      merged.completed += r.completed;
      merged.pendingNewer += r.pendingNewer;
      merged.failed += r.failed;
      merged.items.push(...r.items);
    }
    return merged;
  } catch (err) {
    console.error(
      '[employee-target-recalc] post-commit process failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function enqueueAndMaybeProcessTargetRecalc(params: {
  workDate: string;
  empIds?: number[] | null;
  processNow: boolean;
  reason: string;
  actorUserId: number | null;
}): Promise<{
  enqueued: EnqueueResultItem[];
  process: ProcessEmployeeTargetRecalcRequestsResult | null;
}> {
  let scopes: TargetRecalcScope[];
  if (params.empIds != null && params.empIds.length > 0) {
    const { listActiveBranches } = await import('@/lib/branch');
    const branches = await listActiveBranches();
    scopes = [];
    for (const branch of branches) {
      for (const empId of params.empIds) {
        scopes.push({
          empId,
          branchId: branch.branchId,
          workDate: params.workDate,
          reasons: [params.reason],
        });
      }
    }
  } else {
    // Day-wide: only employees that already have a request OR we enqueue from enabled plans?
    // Spec: enqueue day means process pending for day OR create for given empIds.
    // For empty empIds = process existing pending for that day only via process API.
    // Enqueue without empIds: create nothing new — list eligible is heavy.
    // UI "recalculate day" should pass all plan empIds OR call process on pending + generate all.
    // Phase 5: when empIds omitted, enqueue is skip and processNow processes day pending;
    // also call generate for whole day after enqueue of nothing.
    scopes = [];
  }

  const enqueued =
    scopes.length > 0
      ? await enqueueEmployeeTargetRecalculationsStandalone({
          scopes,
          reason: params.reason,
          sourceType: 'manual_api',
          sourceRef: params.workDate,
        })
      : [];

  let process: ProcessEmployeeTargetRecalcRequestsResult | null = null;
  if (params.processNow) {
    if (scopes.length > 0) {
      process = await processEmployeeTargetRecalcRequests({
        workDate: params.workDate,
        empIds: params.empIds,
        maxRequests: Math.min(50, Math.max(10, scopes.length)),
        actorUserId: params.actorUserId,
      });
    } else {
      // Whole day: generate all eligible plans per active branch + clear pending
      const { listActiveBranches } = await import('@/lib/branch');
      const branches = await listActiveBranches();
      for (const branch of branches) {
        await generateEmployeeDailyTargets({
          workDate: params.workDate,
          branchId: branch.branchId,
          generatedByUserId: params.actorUserId,
        });
      }
      process = await processEmployeeTargetRecalcRequests({
        workDate: params.workDate,
        maxRequests: 50,
        actorUserId: params.actorUserId,
      });
      // Mark any remaining completed? generate already updated targets;
      // process handles pending rows. If no pending left claimed=0.
    }
  }

  return { enqueued, process };
}

export async function getTargetRecalcRequestsForApi(params: {
  workDate?: string;
  empId?: number | null;
  status?: TargetRecalcRequestStatus | null;
  limit?: number;
}): Promise<TargetRecalcRequestRow[]> {
  return listTargetRecalcRequests({
    workDate: params.workDate,
    empId: params.empId,
    status: params.status,
    limit: params.limit ?? 100,
  });
}
