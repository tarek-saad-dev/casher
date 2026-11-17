import { NextRequest, NextResponse } from "next/server";
import { authenticate, isAuthResult } from "@/lib/api-auth";
import { validateUserBranchAccess } from "@/lib/branch";
import { getPool } from "@/lib/db";
import { allowCashierConsume, consumeCashierVoucher, CASHIER_REDEEM_FLAG } from "@/lib/cut-club/cashierVoucher";
import { resolveTrustedLegacySalonId } from "@/lib/cut-club/cashierSalonMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex" };

/** CASHER canonical host must come from server config, never Host/X-Forwarded-Host. */
function trustedCashierOrigin(req: NextRequest): boolean {
  const configured = process.env.CASHER_CANONICAL_ORIGIN;
  if (!configured || !/^https:\/\/[^/@]+$/i.test(configured)) return false;
  return req.headers.get("origin") === configured &&
    req.headers.get("sec-fetch-site") === "same-origin";
}

export async function POST(req: NextRequest) {
  if (process.env[CASHIER_REDEEM_FLAG] !== "true") {
    return NextResponse.json({ ok: false, error: "استخدام القسيمة غير مفعّل حاليًا" },
      { status: 404, headers });
  }
  if (!trustedCashierOrigin(req)) {
    return NextResponse.json({ ok: false, error: "طلب غير مصرح" }, { status: 403, headers });
  }
  const staff = await authenticate();
  if (!isAuthResult(staff)) return staff;
  try {
    const branch = await validateUserBranchAccess(staff.userId, staff.activeBranchId);
    if (!branch.canOperate) return NextResponse.json({ ok: false, error: "غير مصرح" },
      { status: 403, headers });
    const legacySalonId = resolveTrustedLegacySalonId({ trustedTenantId: staff.tenantId, trustedBranchId: staff.activeBranchId });
    if (legacySalonId === null) return NextResponse.json({ ok: false, error: "ربط الصالون بالفرع غير معتمد" }, { status: 503, headers });
    const body: unknown = await req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "بيانات غير صحيحة" }, { status: 400, headers });
    }
    const payload = body as Record<string, unknown>;
    const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
    const scope = { tenantId: staff.tenantId, activeBranchId: staff.activeBranchId, legacySalonId, staffUserId: staff.userId };
    if (!allowCashierConsume({ featureEnabled: true, scope, code, invoiceId: payload.invoiceId })) {
      return NextResponse.json({ ok: false, error: "ادخل رقم فاتورة صحيح وكود القسيمة" },
        { status: 400, headers });
    }
    const result = await consumeCashierVoucher({
      pool: await getPool(), scope, code, invoiceId: payload.invoiceId as number,
      featureEnabled: true,
    });
    if (!result.ok) return NextResponse.json({
      ok: false, error: "لم يتم الاستخدام: راجع العميل والفرع والفاتورة وتطبيق الخدمة المجانية",
    }, { status: 409, headers });
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "تعذر إكمال استخدام القسيمة" },
      { status: 503, headers });
  }
}
export async function OPTIONS() {
  return NextResponse.json({ ok: false }, { status: 405, headers });
}
