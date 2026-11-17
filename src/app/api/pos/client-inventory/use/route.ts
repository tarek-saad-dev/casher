/**
 * CUT CLUB legacy POS voucher-use endpoint retired (#302).
 *
 * Previously marked a voucher USED before ensuring a real invoice/benefit was
 * saved. Unsafe for customer rights and concurrency. DO NOT revive this path
 * through client-supplied inventoryId, notes or invoiceId.
 *
 * Replacement (after coordinated review): staff-scoped GET
 * /api/pos/cut-club/vouchers?code=... then invoice-verified
 * POST /api/pos/cut-club/redeem.
 */
import { NextResponse } from "next/server";
import { requireTenantSession } from "@/lib/api-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await requireTenantSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json({
    ok: false,
    error: "طريقة استخدام القسيمة القديمة موقوفة لحماية رصيد العميل. احفظ الفاتورة ثم استخدم CUT CLUB للكاشير.",
    code: "LEGACY_VOUCHER_USE_DISABLED",
  }, {
    status: 410,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function OPTIONS() {
  return NextResponse.json({ ok: false }, { status: 405 });
}
