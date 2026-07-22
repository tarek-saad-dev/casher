import { NextRequest, NextResponse } from "next/server";
import { toggleDbTarget, getDbConnectionInfo } from "@/lib/db";
import {
  isAuthResult,
  logSecurityEvent,
  requireDevelopmentAdmin,
} from "@/lib/api-auth";

export const runtime = "nodejs";

// Simple rate limiting - prevent rapid toggling
const RATE_LIMIT_MS = 5000; // 5 seconds between toggles
let lastToggleTime = 0;

function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastToggleTime < RATE_LIMIT_MS) {
    return false;
  }
  lastToggleTime = now;
  return true;
}

// GET /api/db/toggle - Get current database target (development admin only)
export async function GET() {
  const auth = await requireDevelopmentAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const info = getDbConnectionInfo();
    return NextResponse.json({
      success: true,
      currentTarget: info.target,
      local: info.local,
      cloud: info.cloud,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/db/toggle] GET error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// POST /api/db/toggle - Toggle between local and cloud (development admin only)
export async function POST(req: NextRequest) {
  const auth = await requireDevelopmentAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    if (!checkRateLimit()) {
      return NextResponse.json(
        { success: false, error: "يرجى الانتظار 5 ثوانٍ بين كل تبديل" },
        { status: 429 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const target = body.target; // Optional: can specify "local" or "cloud"

    let newTarget: "local" | "cloud";

    if (target === "local" || target === "cloud") {
      const { setDbTarget } = await import("@/lib/db");
      await setDbTarget(target);
      newTarget = target;
    } else {
      newTarget = await toggleDbTarget();
    }

    logSecurityEvent("db_target_toggled", {
      userId: auth.userId,
      userName: auth.userName,
      newTarget,
    });

    const info = getDbConnectionInfo();

    return NextResponse.json({
      success: true,
      message: `تم التبديل إلى ${newTarget === "local" ? "الخادم المحلي" : "السحابة"}`,
      currentTarget: newTarget,
      local: info.local,
      cloud: info.cloud,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/db/toggle] POST error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
