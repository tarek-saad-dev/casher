/**
 * CUT CLUB 2.0 — legacy public profile PATCH quarantine (#272).
 *
 * Caller-selected JSON clientId is not verified customer identity.
 * Until a customer-specific OTP/session and tenant-authorized replacement
 * exist, anonymous clients must not update another customer's profile.
 * This also rejects spoofed staff cookies, bearer tokens and debug flags.
 *
 * Does NOT change public booking, catalog or phone lookup GET flows.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'",
  "Vary": "Origin",
} as const;

function denyLegacyProfileUpdate() {
  return NextResponse.json(
    { ok: false, message: "Verified customer sign-in is required to update a profile" },
    { status: 403, headers },
  );
}

/** No JSON body parsing, tenant lookup or DB mutation in this retired route. */
export async function PATCH() {
  return denyLegacyProfileUpdate();
}

/** No cross-origin preflight is allowed for legacy unauthenticated writes. */
export async function OPTIONS() {
  return denyLegacyProfileUpdate();
}
