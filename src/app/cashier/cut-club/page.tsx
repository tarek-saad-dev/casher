import { redirect } from "next/navigation";
import { authenticate, isAuthResult } from "@/lib/api-auth";
import { validateUserBranchAccess } from "@/lib/branch";
import CashierCutClubClient from "./CashierCutClubClient";

export const dynamic = "force-dynamic";

export default async function CashierCutClubPage() {
  const staff = await authenticate();
  if (!isAuthResult(staff)) redirect("/login");
  try {
    const access = await validateUserBranchAccess(staff.userId, staff.activeBranchId);
    if (!access.canOperate) redirect("/403");
  } catch {
    redirect("/403");
  }
  return (
    <CashierCutClubClient
      branchName={staff.activeBranchCode}
      readEnabled={process.env.CUT_CLUB_CASHIER_V2_READ_ENABLED === "true"}
      redemptionEnabled={process.env.CUT_CLUB_CASHIER_V2_REDEEM_ENABLED === "true"}
    />
  );
}
