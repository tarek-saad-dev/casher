import { NextRequest, NextResponse } from 'next/server';

// POST /api/admin/approvals/:id/approve — DISABLED
// The approval workflow has been retired. Sensitive operations execute immediately
// and are recorded in TblSensitiveActionAuditLog.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'تم إيقاف workflow الموافقات. استخدم سجل التدقيق الجديد.' },
    { status: 410 }
  );
}
