import { NextRequest, NextResponse } from "next/server";
import { authenticate, isAuthResult } from "@/lib/api-auth";
import { validateUserBranchAccess } from "@/lib/branch";
import { getPool } from "@/lib/db";
import { inspectCashierVoucher } from "@/lib/cut-club/cashierVoucher";
import { resolveTrustedLegacySalonId } from "@/lib/cut-club/cashierSalonMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex" };

export async function GET(request: NextRequest) {
  if (process.env.CUT_CLUB_CASHIER_V2_READ_ENABLED !== "true") {
    return NextResponse.json({ ok: false, error: "غير متاح حاليًا" }, { status: 404, headers });
  }
  const staff = await authenticate();
  if (!isAuthResult(staff)) return staff;
  try {
    const branch = await validateUserBranchAccess(staff.userId, staff.activeBranchId);
    if (!branch.canOperate) return NextResponse.json({ ok: false, error: "غير مصرح" }, { status: 403, headers });
    const legacySalonId = resolveTrustedLegacySalonId({ trustedTenantId: staff.tenantId, trustedBranchId: staff.activeBranchId });
    if (legacySalonId === null) return NextResponse.json({ ok: false, error: "ربط الصالون بالفرع غير معتمد" }, { status: 503, headers });
    const code = request.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
    if (!/^[A-Z0-9-]{6,100}$/.test(code)) {
      return NextResponse.json({ ok: false, error: "كود القسيمة غير صحيح" }, { status: 400, headers });
    }
    const voucher = await inspectCashierVoucher({
      pool: await getPool(),
      scope: { tenantId: staff.tenantId, activeBranchId: staff.activeBranchId, legacySalonId, staffUserId: staff.userId },
      code,
    });
    if (!voucher) return NextResponse.json({ ok: false, error: "القسيمة غير موجودة لهذا الفرع" },
      { status: 404, headers });
    return NextResponse.json({ ok: true, voucher }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "تعذر التحقق من القسيمة" },
      { status: 503, headers });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: false }, { status: 405, headers });
}
