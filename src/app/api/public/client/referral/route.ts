// The legacy public referral demo was not authenticated and returned
// fabricated codes/points for arbitrary client IDs. Keep it unavailable
// until a tenant-owned, OTP-authenticated customer self-service API exists.
// Staff use /api/pos/referrals/customer-profile; managers use the admin API.
import { NextResponse } from 'next/server';
import type { LoyaltyErrorResponse } from '@/lib/loyalty/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(): Promise<NextResponse<LoyaltyErrorResponse>> {
  return NextResponse.json(
    { ok: false, error: 'بوابة إحالات العملاء غير متاحة حاليًا؛ تواصل مع الاستقبال' },
    { status: 410, headers },
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers });
}
