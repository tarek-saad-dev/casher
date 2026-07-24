import { NextResponse } from 'next/server';
import { getSession, verifySessionCookie, destroySession, readSessionCookie } from '@/lib/session';
import { getActiveBranchContext } from '@/lib/branch/context';
import { listSwitchableBranchesForUser } from '@/lib/branch/switchBranch';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/branches
 * Returns switchable branches for the authenticated user (CanOperate + active).
 */
export async function GET() {
  try {
    const verified = await verifySessionCookie();
    if (!verified.ok) {
      if (verified.reason !== 'missing' && (await readSessionCookie())) {
        await destroySession();
      }
      return NextResponse.json(
        { ok: false, error: 'UNAUTHORIZED', message: 'يلزم تسجيل الدخول' },
        { status: 401 },
      );
    }

    const user = await getSession();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'UNAUTHORIZED', message: 'يلزم تسجيل الدخول' },
        { status: 401 },
      );
    }

    const ctx = await getActiveBranchContext();
    if (!ctx) {
      await destroySession();
      return NextResponse.json(
        { ok: false, error: 'SESSION_INVALID', message: 'يلزم إعادة تسجيل الدخول' },
        { status: 401 },
      );
    }

    const branches = await listSwitchableBranchesForUser(user.UserID, ctx.branchId);

    return NextResponse.json({
      ok: true,
      activeBranch: {
        branchId: ctx.branchId,
        branchCode: ctx.branchCode,
        branchName: ctx.branchName,
        shortName: ctx.shortName,
      },
      branches,
    });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.code, message: err.message },
        { status: err.status },
      );
    }
    console.error('[auth/branches GET]', err);
    return NextResponse.json(
      { ok: false, error: 'INTERNAL', message: 'فشل تحميل الفروع' },
      { status: 500 },
    );
  }
}
