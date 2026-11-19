import { NextResponse } from "next/server";
import { authenticate, isAuthResult } from "@/lib/api-auth";
import { validateUserBranchAccess } from "@/lib/branch";
import { getPool } from "@/lib/db";
import { isCutClubCashierBranchApproved } from "@/lib/cut-club/cashierProductionBranchPolicy";
import { STAGING_VOUCHER_INVOICE_FLAG } from "@/lib/cut-club/stagingInvoiceClaim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex" };

// This status is NOT a release flag for customers or the production cashier.
// It only controls a staging-only voucher input in the authenticated POS UI.
export async function GET() {
  const disabled = () => NextResponse.json({ enabled: false }, { headers });
  if (process.env[STAGING_VOUCHER_INVOICE_FLAG] !== "true") return disabled();
  const staff = await authenticate();
  if (!isAuthResult(staff)) return staff;
  try {
    const branch = await validateUserBranchAccess(staff.userId, staff.activeBranchId);
    if (!branch.canOperate || !isCutClubCashierBranchApproved({
      trustedTenantId: staff.tenantId,
      trustedBranchId: staff.activeBranchId,
      allowlistJson: process.env.CUT_CLUB_STAGING_APPROVED_BRANCHES_JSON,
    })) return disabled();
    const check = await (await getPool()).request().query<{
      DbName: string; LoginName: string; HasClaimTable: number;
    }>(`
      SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName,
        CASE WHEN OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim', N'U') IS NOT NULL
          THEN 1 ELSE 0 END AS HasClaimTable
    `);
    const context = check.recordset[0];
    return NextResponse.json({
      enabled: context?.DbName === "last132_agent" &&
        context?.LoginName === "drvo_agent" && context?.HasClaimTable === 1,
    }, { headers });
  } catch {
    return disabled();
  }
}
