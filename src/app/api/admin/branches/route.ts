import { NextResponse } from 'next/server';
import { getActiveBranchContext, requireBranchAdminAccess } from '@/lib/branch/context';
import { listAllBranches } from '@/lib/branch/repository';
import { serializeBranch } from '@/lib/branch/serializeBranch';
import { BranchDomainError } from '@/lib/branch/types';
import { listTenantLegacyBranchIds } from '@/platform/tenant/tenantContext';

export const runtime = 'nodejs';

/**
 * GET /api/admin/branches
 * Lists all branches for the admin hub (including SETUP).
 */
export async function GET() {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const [branches, active, tenantBranchIds] = await Promise.all([
      listAllBranches(),
      getActiveBranchContext(),
      listTenantLegacyBranchIds(admin.tenantId),
    ]);
    return NextResponse.json({
      ok: true,
      activeBranchId: active?.branchId ?? null,
      branches: branches.filter((b) => tenantBranchIds.has(b.branchId)).map(serializeBranch),
    });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches GET]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحميل الفروع' }, { status: 500 });
  }
}
