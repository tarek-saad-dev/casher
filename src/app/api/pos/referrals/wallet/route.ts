import { NextRequest, NextResponse } from 'next/server';
import { requireTenantSession } from '@/lib/api-auth';
import { ReferralCheckoutError } from '@/lib/referrals/referralCheckoutPolicy';
import { listTenantReferralRewardWallet } from '@/lib/referrals/referralRewardWallet.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Staff-only GET; reads active unexpired referral vouchers, never consumes. */
export async function GET(req: NextRequest) {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;
  const raw = new URL(req.url).searchParams.get('clientId');
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) {
    return NextResponse.json({ error: 'عميل غير صالح' }, { status: 400 });
  }
  const clientId = Number(raw);
  if (!Number.isSafeInteger(clientId) || clientId > 2_147_483_647) {
    return NextResponse.json({ error: 'عميل غير صالح' }, { status: 400 });
  }
  try {
    const vouchers = await listTenantReferralRewardWallet({
      tenantId: String(session.TenantId),
      clientId,
    });
    return NextResponse.json(
      { ok: true, previewOnly: true, clientId, vouchers },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error instanceof ReferralCheckoutError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    console.error('[referrals/wallet] failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json(
      { ok: false, error: 'تعذر تحميل المكافآت' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
