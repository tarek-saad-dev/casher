import { NextRequest, NextResponse } from 'next/server';
import { requireTenantSession } from '@/lib/api-auth';

// POST /api/admin/approvals/:id/approve — DISABLED
// The approval workflow has been retired. Sensitive operations execute immediately
// and are recorded in TblSensitiveActionAuditLog.
export async function POST(_req: NextRequest) {
  const tenantSession = await requireTenantSession();
  if (tenantSession instanceof NextResponse) return tenantSession;
  return NextResponse.json(
    { error: 'تم إيقاف workflow الموافقات. استخدم سجل التدقيق الجديد.' },
    { status: 410 }
  );
}
