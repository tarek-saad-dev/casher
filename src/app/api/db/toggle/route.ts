import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbTarget, toggleDbTarget, getDbConnectionInfo } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/db/toggle - Get current database target
export async function GET() {
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
      { status: 500 }
    );
  }
}

// POST /api/db/toggle - Toggle between local and cloud
export async function POST(req: NextRequest) {
  try {
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
      { status: 500 }
    );
  }
}
