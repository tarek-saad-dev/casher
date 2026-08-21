/**
 * Isolated write-env probe — public so E2E can reach it without a session.
 * Gated by bookingV2 write safety (never Azure/last132).
 */
import { NextResponse } from 'next/server';
import { assertBookingV2WriteTestSafety } from '@/lib/booking/bookingV2WriteSafety';
import { getDbConnectionInfo, getPool } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const safety = assertBookingV2WriteTestSafety();
  if (!safety.ok) {
    return NextResponse.json({ ok: false, error: 'DENIED', safety }, { status: 404 });
  }

  const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = [];
  try {
    const db = await getPool();
    const who = await db.request().query('SELECT DB_NAME() AS db, SUSER_SNAME() AS login');
    steps.push({ step: 'pool', ok: true, detail: who.recordset[0] });

    const { listActiveBranches, getBranchByCode } = await import(
      '@/lib/branch/repository'
    );
    const active = await listActiveBranches();
    steps.push({
      step: 'listActiveBranches',
      ok: true,
      detail: active.map((b) => ({
        id: b.branchId,
        code: b.branchCode,
        life: b.lifecycleStatus,
        pub: b.publicBookingEnabled,
      })),
    });

    const gleem = await getBranchByCode('GLEEM');
    steps.push({
      step: 'getBranchByCode(GLEEM)',
      ok: !!gleem,
      detail: gleem
        ? { id: gleem.branchId, code: gleem.branchCode, life: gleem.lifecycleStatus }
        : null,
    });

    const { listPublicDiscoverableBranches } = await import(
      '@/lib/booking/publicBookingBranchContext'
    );
    const disc = await listPublicDiscoverableBranches();
    steps.push({
      step: 'discoverable',
      ok: true,
      detail: disc.map((b) => b.branchCode),
    });

    const { buildPublicBookingV2Bootstrap } = await import(
      '@/lib/booking/v2Frontend/buildPublicBootstrap'
    );
    const boot = await buildPublicBookingV2Bootstrap({ forceRefresh: true });
    steps.push({
      step: 'bootstrap',
      ok: true,
      detail: {
        branches: boot.body.branches.length,
        employees: boot.body.employees.length,
      },
    });
  } catch (e) {
    steps.push({
      step: 'error',
      ok: false,
      detail: {
        name: e instanceof Error ? e.name : 'err',
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack?.slice(0, 2000) : null,
        code: e && typeof e === 'object' && 'code' in e ? (e as { code: unknown }).code : null,
      },
    });
  }

  const { getSlotClaimShadowStats } = await import(
    '@/lib/booking/claims/slotClaimShadowTelemetry'
  );

  return NextResponse.json({
    ok: steps.every((s) => s.ok),
    safety,
    db: getDbConnectionInfo(),
    slotClaimShadow: getSlotClaimShadowStats(),
    steps,
  });
}
