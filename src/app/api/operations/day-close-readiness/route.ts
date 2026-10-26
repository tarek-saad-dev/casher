import { NextResponse } from 'next/server';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { getSalonCloseReadiness } from '@/packs/salon/closeReadiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Authenticated, active-branch-scoped read-only operational preflight. */
export async function GET() {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;
    return NextResponse.json({ ok: true, readiness: await getSalonCloseReadiness(branch) });
  } catch (error) {
    console.error('[salon day-close readiness]', error);
    return NextResponse.json(
      { ok: false, error: 'تعذر تحميل جاهزية قفل اليوم. أعد المحاولة قبل القفل.' },
      { status: 500 },
    );
  }
}
