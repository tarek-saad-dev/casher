import { NextRequest, NextResponse } from 'next/server';
import { requireBranchAdminAccess } from '@/lib/branch/context';
import { provisionBranch } from '@/lib/branch/branchProvisioningService';
import { BranchDomainError } from '@/lib/branch/types';
import { CommercialError } from '@/platform/commercial/errors';

export const runtime = 'nodejs';

/**
 * POST /api/admin/branches/provision
 * Creates a branch in SETUP with public booking off.
 */
export async function POST(req: NextRequest) {
  const admin = await requireBranchAdminAccess();
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await req.json();
    const result = await provisionBranch(body, { userId: admin.userId, tenantId: admin.tenantId });
    return NextResponse.json({
      ok: true,
      message: 'تم إنشاء الفرع في وضع الإعداد (SETUP)',
      branch: {
        branchId: result.branch.branchId,
        branchCode: result.branch.branchCode,
        branchName: result.branch.branchName,
        lifecycleStatus: result.branch.lifecycleStatus,
        isActive: result.branch.isActive,
        publicBookingEnabled: result.branch.publicBookingEnabled,
      },
      queueSettingsCreated: result.queueSettingsCreated,
      partnerSharesSeeded: result.partnerSharesSeeded,
      actorAccessGranted: result.actorAccessGranted,
    });
  } catch (err) {
    if (err instanceof CommercialError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[admin/branches/provision]', err);
    return NextResponse.json({ ok: false, error: 'فشل إنشاء الفرع' }, { status: 500 });
  }
}
