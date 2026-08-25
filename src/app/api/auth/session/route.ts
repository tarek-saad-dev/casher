import { NextResponse } from "next/server";
import {
  destroySession,
  getSession,
  readSessionCookie,
  verifySessionCookie,
} from "@/lib/session";
import { getUserFriendlyError } from "@/lib/db";
import {
  loadOperationalBootstrap,
  toLegacySessionPayload,
} from "@/modules/operations/application/loadOperationalBootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emptySessionBody(extra: Record<string, unknown> = {}) {
  return {
    user: null,
    day: null,
    shift: null,
    permissions: [],
    roles: [],
    allowedPagePaths: [],
    activeBranch: null,
    defaultShiftId: null,
    ...extra,
  };
}

// GET /api/auth/session — compatibility adapter over operational bootstrap
export async function GET() {
  try {
    const verified = await verifySessionCookie();
    if (!verified.ok) {
      if (verified.reason !== "missing" && (await readSessionCookie())) {
        await destroySession();
      }
      return NextResponse.json(
        emptySessionBody(
          verified.reason === "missing"
            ? {}
            : {
                error: "يلزم إعادة تسجيل الدخول",
                code:
                  verified.reason === "legacy" ||
                  verified.reason === "unsupported_version"
                    ? "SESSION_UPGRADE_REQUIRED"
                    : "SESSION_INVALID",
              },
        ),
        verified.reason === "missing" ? undefined : { status: 401 },
      );
    }

    const user = await getSession();
    if (!user) {
      await destroySession();
      return NextResponse.json(emptySessionBody());
    }

    const result = await loadOperationalBootstrap({ user });
    if (!result.ok) {
      return NextResponse.json(
        emptySessionBody({ error: result.message, code: result.code }),
        { status: result.status },
      );
    }

    return NextResponse.json(toLegacySessionPayload(result.data));
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/session] GET error:", rawMessage);
    const userMessage = getUserFriendlyError(err);
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}

// DELETE /api/auth/session — logout
export async function DELETE() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/session] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
