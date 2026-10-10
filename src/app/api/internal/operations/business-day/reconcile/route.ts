import { NextRequest, NextResponse } from 'next/server';
import {
  isSystemJobAuthResult,
  logSecurityEvent,
  requireSystemJobAuth,
} from '@/lib/api-auth';
import { reconcileAllBusinessDays } from '@/modules/operations/application/reconcileBusinessDay';
import type { ReconcileTrigger } from '@/modules/operations/infra/businessDayMutationTx';
import { runTenantJobFanout, tenantJobScopeFor } from '@/platform/tenant/tenantJobFanout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/internal/operations/business-day/reconcile
 *
 * Automated execution: Authorization: Bearer $CRON_SECRET (preferred).
 * Manual diagnostics: authenticated admin session (explicitly audited).
 *
 * The cron schedule is only a "check branches now" trigger.
 * BusinessClock decides whether each branch is past its local 08:00 window.
 * Client-supplied BranchID is ignored. Runs tenant-by-tenant (active subscription only);
 * a manual admin session only reconciles its own tenant.
 */
async function run(req: NextRequest) {
  const jobAuth = await requireSystemJobAuth(req);
  if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

  const trigger: ReconcileTrigger =
    jobAuth.via === 'cron_bearer' ? 'SCHEDULED' : 'MANUAL_INTERNAL';

  if (jobAuth.via === 'session') {
    logSecurityEvent('BUSINESS_DAY_RECONCILE_MANUAL', {
      via: 'session',
      userId: jobAuth.userId,
      userName: jobAuth.userName,
    });
  }

  const { outcomes, skipped } = await runTenantJobFanout(
    { scope: tenantJobScopeFor(jobAuth), job: 'business-day-reconcile' },
    (target) => reconcileAllBusinessDays({ trigger, branchIds: target.branchIds }),
  );
  const ok = outcomes.every((o) => o.ok && o.result?.ok !== false);
  return NextResponse.json(
    {
      ok,
      trigger,
      results: outcomes.flatMap((o) => o.result?.results ?? []),
      tenants: outcomes.map((o) => ({ tenantCode: o.tenantCode, ok: o.ok && o.result?.ok !== false, error: o.error })),
      skippedTenants: skipped,
    },
    { status: ok ? 200 : 207 },
  );
}

export async function POST(req: NextRequest) {
  try {
    return await run(req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/internal/operations/business-day/reconcile] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Vercel Cron sends GET. Same auth + reconcile as POST. */
export async function GET(req: NextRequest) {
  return POST(req);
}
