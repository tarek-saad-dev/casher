/**
 * CUT CLUB legacy account-private GET quarantine — security issue #274.
 * Formerly selected a customer via request-controlled clientId, which is NOT
 * authentication. The original data/service implementation is deliberately
 * unreachable at this URL. A future verified customer API will use new paths.
 * No customer data or financial state is read or changed.
 */
import { rejectLegacyMemberRead } from "@/lib/cut-club/legacyMemberReadQuarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return rejectLegacyMemberRead();
}

export async function OPTIONS() {
  return rejectLegacyMemberRead();
}
