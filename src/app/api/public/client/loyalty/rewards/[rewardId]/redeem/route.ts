/**
 * Legacy CUT CLUB reward redemption quarantine — Issue #270.
 *
 * SECURITY: a URL-controlled clientId is not verified customer identity.
 * No anonymous caller may deduct Coins or generate an unbacked redemption.
 * This legacy route stays unavailable until a separate authenticated,
 * tenant-authorized replacement is approved and implemented.
 *
 * IMPORTANT: No environment flag, staff session or API header can bypass
 * this quarantine. This does NOT enable or protect private GET endpoints.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const quarantineHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'",
  "Vary": "Origin",
} as const;

function rejectUnauthenticatedRewardRedemption() {
  return NextResponse.json(
    { ok: false, error: "CUT CLUB reward redemption requires verified customer sign-in" },
    { status: 403, headers: quarantineHeaders },
  );
}

/** No request parsing, reward lookup, session assumptions or database access. */
export async function POST() {
  return rejectUnauthenticatedRewardRedemption();
}

/** Do not authorize CORS preflight for this legacy financial write. */
export async function OPTIONS() {
  return rejectUnauthenticatedRewardRedemption();
}
