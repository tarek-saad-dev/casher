import { NextRequest, NextResponse } from 'next/server';
import { runNightlyClose, type NightlyCloseResult } from '@/lib/hr/nightly-close.service';
import { resolveNightlyCloseWorkDate } from '@/lib/hr/nightly-close-work-date';
import { resolveHrTimeZoneForBranches } from '@/lib/hr/hrTenantScope';
import {
  isSystemJobAuthResult,
  requireSystemJobAuth,
  type SystemJobAuthResult,
} from '@/lib/api-auth';
import { resolveLegacyBootstrapTenantId } from '@/platform/tenant/legacyBootstrapSeam';
import {
  runTenantJobFanout,
  tenantJobScopeFor,
  type TenantJobOutcome,
  type TenantJobSkip,
} from '@/platform/tenant/tenantJobFanout';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function runForTenants(
  jobAuth: SystemJobAuthResult,
  opts: { workDateOverride: string | null; dryRun: boolean; skipWhatsApp: boolean },
) {
  // The daily HR WhatsApp reports are only proven for CASHER_BOOT (recipients and wording are CUT's),
  // so other tenants close payroll without them; the send itself goes through the tenant channel.
  const hrReportTenantId = await resolveLegacyBootstrapTenantId('legacy-global-data');
  const legacyLogTenantId = await resolveLegacyBootstrapTenantId('legacy-payroll-job-log');
  return runTenantJobFanout(
    { scope: tenantJobScopeFor(jobAuth), app: 'payroll', job: 'nightly-close' },
    async (target) => {
      // Each tenant closes "yesterday" in its own HR time zone (Africa/Cairo by default).
      const timeZone = await resolveHrTimeZoneForBranches(target.branchIds);
      return runNightlyClose({
        tenantId: target.tenantId,
        workDate: resolveNightlyCloseWorkDate(opts.workDateOverride, new Date(), timeZone),
        timeZone,
        dryRun: opts.dryRun,
        skipWhatsApp: opts.skipWhatsApp || target.tenantId !== hrReportTenantId,
        branchIds: target.branchIds,
        legacyJobLog: target.tenantId === legacyLogTenantId,
      });
    },
  );
}

/** A session caller gets its own tenant's result shape; a cron bearer gets every tenant. */
function respond(
  jobAuth: SystemJobAuthResult,
  fanout: { outcomes: TenantJobOutcome<NightlyCloseResult>[]; skipped: TenantJobSkip[] },
  extra: Record<string, unknown> = {},
) {
  const { outcomes, skipped } = fanout;
  if (jobAuth.via === 'session') {
    const own = outcomes[0];
    if (!own) {
      return NextResponse.json(
        { ok: false, error: 'تطبيق الرواتب أو اشتراك المنشأة غير نشط', code: skipped[0]?.reason ?? 'TENANT_SKIPPED' },
        { status: 403 },
      );
    }
    if (!own.ok || !own.result) {
      return NextResponse.json({ ok: false, error: own.error ?? 'Unknown error' }, { status: 500 });
    }
    return NextResponse.json({ ...own.result, ...extra }, { status: own.result.ok ? 200 : 422 });
  }
  const ok = outcomes.every((o) => o.ok && o.result?.ok);
  return NextResponse.json(
    {
      ok,
      ...extra,
      tenants: outcomes.map((o) => ({ tenantCode: o.tenantCode, ok: o.ok && Boolean(o.result?.ok), result: o.result, error: o.error })),
      skippedTenants: skipped,
    },
    { status: ok ? 200 : 207 },
  );
}

/**
 * POST /api/admin/hr/nightly-close
 * Auth: Authorization: Bearer $CRON_SECRET (every tenant with active subscription + payroll app)
 *       OR authenticated admin session (that admin's tenant only).
 * Body: { workDate?, dryRun?, skipWhatsApp? }
 *
 * Closes Cairo-yesterday by default (e.g. 01:00 on the 15th → workDate 14).
 */
export async function POST(req: NextRequest) {
  try {
    const jobAuth = await requireSystemJobAuth(req);
    if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

    const body = await req.json().catch(() => ({}));
    const fanout = await runForTenants(jobAuth, {
      workDateOverride: typeof body?.workDate === 'string' ? body.workDate : null,
      dryRun: Boolean(body?.dryRun),
      skipWhatsApp: Boolean(body?.skipWhatsApp),
    });
    return respond(jobAuth, fanout);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/hr/nightly-close] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const jobAuth = await requireSystemJobAuth(req);
    if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

    const { searchParams } = new URL(req.url);
    const fanout = await runForTenants(jobAuth, {
      workDateOverride: searchParams.get('workDate'),
      dryRun: true,
      skipWhatsApp: false,
    });
    return respond(jobAuth, fanout, { previewOnly: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
