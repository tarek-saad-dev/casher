import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { BranchDomainError } from '@/lib/branch/types';
import { getBranchSetupPolicy } from '@/lib/branch/branchSetupPolicy';
import {
  decideOpeningCashAmount,
  decideOpeningCashZero,
  isOpeningCashResolved,
} from '@/lib/branch/openingCashDecision';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/branches');
  if (!isAuthResult(auth)) return auth;
  const branchId = Number((await params).id);
  if (!Number.isFinite(branchId)) {
    return NextResponse.json({ error: 'معرف فرع غير صالح' }, { status: 400 });
  }
  const policy = await getBranchSetupPolicy(branchId);
  const resolved = await isOpeningCashResolved(branchId);
  return NextResponse.json({
    ok: true,
    resolved,
    decision: policy?.openingCashDecision ?? null,
    amount: policy?.openingCashAmount ?? null,
    effectiveDate: policy?.openingCashEffectiveDate ?? null,
    reason: policy?.openingCashReason ?? null,
    approvedAt: policy?.openingCashApprovedAt ?? null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/branches');
  if (!isAuthResult(auth)) return auth;
  const branchId = Number((await params).id);
  if (!Number.isFinite(branchId)) {
    return NextResponse.json({ error: 'معرف فرع غير صالح' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const decision = String(body.decision || '').toUpperCase();
    if (decision === 'ZERO') {
      const result = await decideOpeningCashZero({
        branchId,
        actorUserId: auth.userId,
        confirmZero: Boolean(body.confirmZero),
      });
      return NextResponse.json({ ok: true, blockerCleared: result.blockerCleared, policy: result.policy });
    }
    if (decision === 'AMOUNT') {
      const result = await decideOpeningCashAmount({
        branchId,
        actorUserId: auth.userId,
        amount: Number(body.amount),
        effectiveDate: String(body.effectiveDate || ''),
        reason: String(body.reason || ''),
      });
      return NextResponse.json({ ok: true, blockerCleared: result.blockerCleared, policy: result.policy });
    }
    return NextResponse.json({ error: 'decision يجب أن يكون ZERO أو AMOUNT' }, { status: 400 });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[opening-cash]', err);
    return NextResponse.json({ error: 'فشل حفظ قرار الخزنة الافتتاحية' }, { status: 500 });
  }
}
