import { NextRequest, NextResponse } from 'next/server';
import { requireTenantSession } from '@/lib/api-auth';
import { ReferralCheckoutError } from '@/lib/referrals/referralCheckoutPolicy';
import {
  getTenantCustomerReferralProfile,
} from '@/lib/referrals/customerReferralProfile.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * Staff-only customer referral profile — NOT the old public/mock loyalty API.
 * No tenant ID may be supplied by the caller; only authenticated session.
 * Never generates/activates codes or grants/consumes rewards.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTenantSession();
  if (auth instanceof NextResponse) return auth;

  const clientIdRaw = new URL(req.url).searchParams.get('clientId');
  if (!clientIdRaw || !/^[1-9][0-9]*$/.test(clientIdRaw)) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_CLIENT_ID', error: 'عميل غير صالح' },
      { status: 400, headers: noStore },
    );
  }
  const clientId = Number(clientIdRaw);
  if (!Number.isSafeInteger(clientId) || clientId > 2_147_483_647) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_CLIENT_ID', error: 'عميل غير صالح' },
      { status: 400, headers: noStore },
    );
  }

  try {
    const profile = await getTenantCustomerReferralProfile({
      tenantId: String(auth.TenantId),
      clientId,
    });
    return NextResponse.json({ ok: true, profile }, { headers: noStore });
  } catch (error) {
    if (error instanceof ReferralCheckoutError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status, headers: noStore },
      );
    }
    console.error('[referrals/customer-profile] read failed',
      error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { ok: false, error: 'تعذر تحميل ملف الإحالات' },
      { status: 500, headers: noStore },
    );
  }
}
