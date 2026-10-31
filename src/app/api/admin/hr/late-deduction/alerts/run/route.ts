/**
 * POST /api/admin/hr/late-deduction/alerts/run
 * Cron / system job: progressive late-arrival WhatsApp alerts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSystemJobAuth } from '@/lib/api-auth';
import { runLateDeductionAlertScan } from '@/lib/hr/late-deduction';
import { runTenantJobFanout, tenantJobScopeFor } from '@/platform/tenant/tenantJobFanout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = await requireSystemJobAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessDate = typeof body.businessDate === 'string' ? body.businessDate : undefined;
    const requestedBranchId = Number(body.branchId) > 0 ? Number(body.branchId) : undefined;

    const { outcomes, skipped } = await runTenantJobFanout(
      { scope: tenantJobScopeFor(auth), app: 'payroll', job: 'late-deduction-alerts' },
      async (target) => {
        const branchIds = requestedBranchId
          ? target.branchIds.filter((id) => id === requestedBranchId)
          : target.branchIds;
        const totals = {
          candidates: 0,
          notified: 0,
          errors: 0,
          skippedBranches: 0,
          recoveredFinalizations: 0,
          recoveryErrors: 0,
        };
        let workDate: string | undefined;
        for (const branchId of branchIds) {
          const r = await runLateDeductionAlertScan({
            businessDate,
            branchId,
            sendInline: true,
          });
          if (r.skipped) totals.skippedBranches += 1;
          totals.candidates += r.candidates;
          totals.notified += r.notified;
          totals.errors += r.errors;
          totals.recoveredFinalizations += r.recoveredFinalizations ?? 0;
          totals.recoveryErrors += r.recoveryErrors ?? 0;
          workDate = r.workDate ?? workDate;
        }
        return { ...totals, branches: branchIds.length, workDate };
      },
    );

    const sum = (
      k:
        | 'candidates'
        | 'notified'
        | 'errors'
        | 'recoveredFinalizations'
        | 'recoveryErrors',
    ) => outcomes.reduce((acc, o) => acc + (o.result?.[k] ?? 0), 0);

    return NextResponse.json({
      ok: outcomes.every((o) => o.ok),
      via: auth.via,
      candidates: sum('candidates'),
      notified: sum('notified'),
      errors: sum('errors'),
      recoveredFinalizations: sum('recoveredFinalizations'),
      recoveryErrors: sum('recoveryErrors'),
      tenants: outcomes.map((o) => ({
        tenantCode: o.tenantCode,
        ok: o.ok,
        error: o.error,
        ...o.result,
      })),
      skippedTenants: skipped,
    });
  } catch (err) {
    console.error('[late-deduction/alerts/run]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل فحص تنبيهات التأخير' },
      { status: 500 },
    );
  }
}
