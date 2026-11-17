/**
 * CUT CLUB legacy unverified phone lookup quarantine (#278).
 * A guessed phone number is not proof of customer identity.
 *
 * No request parsing, customer existence check, database access, staff session
 * bypass or permissive CORS. Real member profile APIs must use verified,
 * revocable customer sessions at a NEW path.
 */
import { NextResponse } from "next/server";

export function rejectAnonymousPhoneProfileLookup() {
  return NextResponse.json(
    { ok: false, error: "Verified customer sign-in required" },
    {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": "default-src 'none'",
        "Vary": "Origin",
      },
    },
  );
}
