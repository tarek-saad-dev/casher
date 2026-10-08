/**
 * POST /api/admin/attendance/auto-absence/run
 * Admin session (own tenant only) OR CRON_SECRET Bearer (every tenant with an active
 * subscription and the attendance app). Each scan only sees that tenant's branches.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSystemJobAuth } from '@/lib/api-auth';
import { runAutoAbsenceScan } from '@/lib/hr/attendance/autoAbsence';
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
      { scope: tenantJobScopeFor(auth), app: 'attendance', job: 'auto-absence' },
      async (target) => {
        const branchIds = requestedBranchId
          ? target.branchIds.filter((id) => id === requestedBranchId)
          : target.branchIds;
        const totals = { processed: 0, markedAbsent: 0, bookingsMarked: 0, configErrors: 0, skippedBranches: 0 };
        for (const branchId of branchIds) {
          const r = await runAutoAbsenceScan({ businessDate, branchId });
          totals.processed += r.processed;
          totals.markedAbsent += r.markedAbsent;
          totals.bookingsMarked += r.bookingsMarked;
          totals.configErrors += r.configErrors ?? 0;
          if (r.skipped) totals.skippedBranches += 1;
        }
        return { ...totals, branches: branchIds.length };
      },
    );

    if (auth.via === 'session' && outcomes.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'تطبيق الحضور أو اشتراك المنشأة غير نشط', code: skipped[0]?.reason ?? 'TENANT_SKIPPED' },
        { status: 403 },
      );
    }
    if (auth.via === 'session' && requestedBranchId && !outcomes.some((o) => (o.result?.branches ?? 0) > 0)) {
      return NextResponse.json({ ok: false, error: 'الفرع غير موجود', code: 'BRANCH_NOT_FOUND' }, { status: 404 });
    }

    const sum = (k: 'processed' | 'markedAbsent' | 'bookingsMarked' | 'configErrors') =>
      outcomes.reduce((acc, o) => acc + (o.result?.[k] ?? 0), 0);
    return NextResponse.json({
      ok: outcomes.every((o) => o.ok),
      via: auth.via,
      processed: sum('processed'),
      markedAbsent: sum('markedAbsent'),
      bookingsMarked: sum('bookingsMarked'),
      configErrors: sum('configErrors'),
      tenants: outcomes.map((o) => ({ tenantCode: o.tenantCode, ok: o.ok, error: o.error, ...o.result })),
      skippedTenants: skipped,
    });
  } catch (err) {
    console.error('[auto-absence/run]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل فحص الغياب التلقائي' },
      { status: 500 },
    );
  }
}
