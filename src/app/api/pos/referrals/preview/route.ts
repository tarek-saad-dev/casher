import { NextRequest, NextResponse } from 'next/server';
import { requireTenantSession } from '@/lib/api-auth';
import {
  getTenantReferralPreview,
  ReferralPreviewNotFoundError,
  ReferralPreviewUnavailableError,
} from '@/lib/referrals/referralPreview.service';
import {
  normalizeReferralCustomerCode,
  parseSqlClientId,
} from '@/lib/referrals/referralPreviewPolicy';

export const runtime = 'nodejs';

/**
 * GET /api/pos/referrals/preview?code=CUT-...&referredClientId=123
 *
 * Staff session required. This API never accepts tenantId from query or body.
 * It does not issue, consume or reserve a code/voucher and MUST NOT cause the
 * POS to apply a discount without server-side sale transaction verification.
 */
export async function GET(req: NextRequest) {
  const auth = await requireTenantSession();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const code = normalizeReferralCustomerCode(url.searchParams.get('code'));
  const referredClientId = parseSqlClientId(url.searchParams.get('referredClientId'));
  if (!code || referredClientId == null) {
    return NextResponse.json(
      { ok: false, error: 'كود إحالة أو عميل غير صالح', code: 'INVALID_REFERRAL_PREVIEW' },
      { status: 400 },
    );
  }

  try {
    const result = await getTenantReferralPreview({
      tenantId: auth.TenantId,
      referredClientId,
      code,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReferralPreviewNotFoundError) {
      // Same generic response for unknown customer, unknown code, and cross-tenant code.
      return NextResponse.json(
        { ok: false, error: 'العميل أو كود الإحالة غير موجود', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    if (error instanceof ReferralPreviewUnavailableError) {
      return NextResponse.json(
        { ok: false, error: 'خدمة الإحالات غير متاحة حاليًا', code: 'REFERRALS_NOT_READY' },
        { status: 503 },
      );
    }
    console.error('[api/pos/referrals/preview] lookup failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { ok: false, error: 'تعذر فحص كود الإحالة' },
      { status: 500 },
    );
  }
}
