import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { BranchDomainError } from '@/lib/branch/types';
import { getBranchSetupPolicy } from '@/lib/branch/branchSetupPolicy';
import {
  isOpeningInventoryResolved,
  OPENING_INVENTORY_OPTIONS,
  selectOpeningInventoryOption,
} from '@/lib/branch/openingInventoryDecision';

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
  const resolved = await isOpeningInventoryResolved(branchId);
  return NextResponse.json({
    ok: true,
    resolved,
    options: OPENING_INVENTORY_OPTIONS,
    current: policy?.openingInventoryOption ?? null,
    approvedAt: policy?.openingInventoryApprovedAt ?? null,
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
    const option = String(body.option || '');
    if (option !== 'ZERO_STOCK' && option !== 'NEW_PURCHASE' && option !== 'TRANSFER_FROM_GLEEM') {
      return NextResponse.json({ error: 'خيار مخزون غير صالح' }, { status: 400 });
    }
    const result = await selectOpeningInventoryOption({
      branchId,
      option,
      actorUserId: auth.userId,
      approveZeroStock: Boolean(body.approveZeroStock),
    });
    return NextResponse.json({
      ok: true,
      blockerCleared: result.blockerCleared,
      policy: result.policy,
    });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[opening-inventory]', err);
    return NextResponse.json({ error: 'فشل حفظ قرار المخزون الافتتاحي' }, { status: 500 });
  }
}
