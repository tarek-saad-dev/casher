// CUT CLUB legacy public buy route — quarantined (#264).
// The caller-controlled ?clientId is NOT customer authentication.
// No DB, ledger, voucher or inventory mutation is permitted here.
import { rejectUnauthenticatedFinancialWrite } from "@/lib/cut-club/legacyFinancialQuarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reject CORS preflight too; there is no public purchase permission. */
export async function OPTIONS() {
  return rejectUnauthenticatedFinancialWrite();
}

/** Use a NEW, verified customer-authenticated route after security #243. */
export async function POST() {
  return rejectUnauthenticatedFinancialWrite();
}
