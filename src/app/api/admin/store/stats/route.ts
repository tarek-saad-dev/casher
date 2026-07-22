// ============================================
// GET /api/admin/store/stats
// Admin Store Statistics
// ============================================

import { NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getStoreStats } from "@/lib/store/store.service";

export const runtime = "nodejs";

export async function GET() {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const stats = await getStoreStats();
    return NextResponse.json({ ok: true, stats });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/stats GET] error:", message);
    return NextResponse.json({ ok: false, error: "Failed to load stats" }, { status: 500 });
  }
}
