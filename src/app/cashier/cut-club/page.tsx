import { redirect } from "next/navigation";
import { authenticate, isAuthResult } from "@/lib/api-auth";
import CashierCutClubClient from "./CashierCutClubClient";

export const dynamic = "force-dynamic";

export default async function CashierCutClubPage() {
  const staff = await authenticate();
  if (!isAuthResult(staff)) redirect("/login");
  return (
    <CashierCutClubClient
      branchName={staff.activeBranchCode}
      readEnabled={process.env.CUT_CLUB_CASHIER_V2_READ_ENABLED === "true"}
      redemptionEnabled={process.env.CUT_CLUB_CASHIER_V2_REDEEM_ENABLED === "true"}
    />
  );
}
