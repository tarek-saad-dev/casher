import { NextRequest, NextResponse } from 'next/server';
import { switchActiveBranch } from '@/lib/branch/switchBranch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/switch-branch
 * Body: { branchId: number }
 * Reissues the signed session cookie with the selected active branch.
 * Never updates IsDefault. Never trusts client permissions.
 */
export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'INVALID_BODY', message: 'جسم الطلب غير صالح' },
        { status: 400 },
      );
    }

    const branchIdRaw =
      body && typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).branchId
        : undefined;
    const branchId =
      typeof branchIdRaw === 'number'
        ? branchIdRaw
        : typeof branchIdRaw === 'string'
          ? parseInt(branchIdRaw, 10)
          : NaN;

    if (!Number.isFinite(branchId) || branchId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_BRANCH', message: 'معرّف الفرع غير صالح' },
        { status: 400 },
      );
    }

    const result = await switchActiveBranch({ branchId, request: req });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.code, message: result.message },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      changed: result.changed,
      activeBranch: result.activeBranch,
    });
  } catch (err) {
    console.error('[auth/switch-branch POST]', err);
    return NextResponse.json(
      { ok: false, error: 'INTERNAL', message: 'فشل تبديل الفرع' },
      { status: 500 },
    );
  }
}
