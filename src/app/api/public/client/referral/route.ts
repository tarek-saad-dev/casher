// ============================================
// GET /api/public/client/referral
// Client Referral Information
// ============================================

import { NextRequest, NextResponse } from "next/server";
import type {
  ClientReferralResponse,
  LoyaltyErrorResponse,
} from "@/lib/loyalty/types";
import {
  generateReferralCode,
  generateReferralShareUrl,
} from "@/lib/loyalty/helpers";

export const runtime = "nodejs";

// CORS headers for public API
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/public/client/referral
 *
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 *
 * TODO: Replace static data with DB lookup when TblClientReferral is created
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<ClientReferralResponse | LoyaltyErrorResponse>> {
  try {
    // TODO: Replace with authenticated session / OTP token
    const { searchParams } = new URL(req.url);
    const clientIdParam = searchParams.get("clientId");

    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: "clientId is required in development mode" },
        { status: 400, headers: corsHeaders },
      );
    }

    const clientId = parseInt(clientIdParam, 10);
    if (isNaN(clientId) || clientId <= 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid clientId" },
        { status: 400, headers: corsHeaders },
      );
    }

    // TODO: Replace with DB lookup when TblClientReferral is created
    // For now, generate static referral info
    const referralCode = generateReferralCode(clientId);
    const shareUrl = generateReferralShareUrl(referralCode);

    // Static values - will be replaced with actual counts from DB later
    const totalReferred = 0;
    const successfulReferrals = 0;
    const rewardPoints = 100;

    const response: ClientReferralResponse = {
      ok: true,
      code: referralCode,
      shareUrl,
      rewardPoints,
      totalReferred,
      successfulReferrals,
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/referral] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load referral data" },
      { status: 500, headers: corsHeaders },
    );
  }
}
