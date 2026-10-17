import { NextResponse } from 'next/server';
import { authorizeDrvoPosSellPreflight } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reserved DRVO invoice write endpoint. Never forwards to legacy POS.
 * No invoice write until a tenant-scoped, transactional sale service with
 * authoritative catalog prices, staff assignment and idempotency exists.
 */
export async function POST() {
  const access = await authorizeDrvoPosSellPreflight();
  if (!access.ok) {
    return NextResponse.json({ ok: false, code: access.code }, {
      status: access.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.json({
    ok: false,
    code: 'POS_INVOICE_WRITES_NOT_READY',
    message: 'إنشاء الفواتير قيد التجهيز ولا يمكن الحفظ حاليًا',
  }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
