/**
 * Admin-only CUT CLUB schema preflight. Feature OFF by default.
 * Read-only production metadata, not a production readiness release gate.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthResult } from "@/lib/api-auth";
import { getPool } from "@/lib/db";
import { expectedProductionDbIsConfigured, readOperatorCashierMetadata } from "@/lib/cut-club/cashierProductionPreflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  if (process.env.CUT_CLUB_PRODUCTION_METADATA_READ_ENABLED !== "true") {
    return NextResponse.json({ ok: false, error: "فحص CUT CLUB غير مفعل" },
      { status: 404, headers });
  }
  const expected = process.env.CUT_CLUB_METADATA_EXPECTED_DB;
  if (!expectedProductionDbIsConfigured(expected)) {
    return NextResponse.json({ ok: false, error: "إعداد قاعدة البيانات يحتاج مراجعة" },
      { status: 503, headers });
  }
  try {
    const data = await readOperatorCashierMetadata({
      pool: await getPool(), operatorExpectedDbName: expected,
    });
    if (!data) return NextResponse.json({
      ok: false, error: "تعذر مطابقة مخطط البيانات. لم يتم قراءة سجلات العملاء.",
    }, { status: 503, headers });
    return NextResponse.json({ ok: true, data }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "تعذر إجراء فحص الهيكل الآمن" },
      { status: 503, headers });
  }
}
export async function OPTIONS() {
  return NextResponse.json({ ok: false }, { status: 405, headers });
}
