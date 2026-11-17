import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { ReferralCheckoutError } from '@/lib/referrals/referralCheckoutPolicy';
import {
  getTenantReferralAdminDashboard,
  parseReferralAdminQuery,
} from '@/lib/referrals/referralAdminDashboard.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * READ-ONLY tenant-owned admin analytics, not legacy coin referral mock data.
 * Session requires administrator privilege and authoritative TenantId;
 * all pagination/search/status inputs are validated and SQL-parameterized.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const query = parseReferralAdminQuery(new URL(req.url));
    const dashboard = await getTenantReferralAdminDashboard({
      tenantId: auth.tenantId, ...query,
    });
    return NextResponse.json({ ok: true, dashboard }, { headers: noStore });
  } catch (error) {
    if (error instanceof ReferralCheckoutError) {
      return NextResponse.json({
        ok: false, code: error.code, error: error.message,
      }, { status: error.status, headers: noStore });
    }
    console.error('[admin/referrals] report failed',
      error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({
      ok: false, error: 'تعذر تحميل بيانات الإحالات',
    }, { status: 500, headers: noStore });
  }
}
