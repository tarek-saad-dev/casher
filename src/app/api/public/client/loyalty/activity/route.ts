// ============================================
// GET /api/public/client/loyalty/activity
// Client Loyalty Activity History
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import type {
  LoyaltyActivityListResponse,
  LoyaltyErrorResponse,
  LoyaltyActivityItem,
} from "@/lib/loyalty/types";
import { mapLedgerToActivityItem } from "@/lib/loyalty/helpers";

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
 * GET /api/public/client/loyalty/activity
 *
 * Query params:
 * - clientId: number (TODO: replace with authenticated session)
 * - page: number (default: 1)
 * - limit: number (default: 10, max: 50)
 * - movementType: string (optional filter)
 * - dateFrom: ISO date (optional filter)
 * - dateTo: ISO date (optional filter)
 */
export async function GET(
  req: NextRequest,
): Promise<NextResponse<LoyaltyActivityListResponse | LoyaltyErrorResponse>> {
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

    // Parse pagination params
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("limit") || "10", 10)),
    );
    const offset = (page - 1) * limit;

    // Parse filter params
    const movementType = searchParams.get("movementType") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";

    const db = await getPool();

    // ============================================
    // 1. Verify client exists and get loyalty ID
    // ============================================
    const clientResult = await db.request().input("clientId", sql.Int, clientId)
      .query(`
        SELECT ClientLoyaltyID
        FROM [dbo].[TblClientLoyalty]
        WHERE ClientID = @clientId
      `);

    if (clientResult.recordset.length === 0) {
      // Return empty activity for new clients (not an error)
      return NextResponse.json(
        {
          ok: true,
          activity: [],
          pagination: {
            page,
            limit,
            totalCount: 0,
            totalPages: 0,
          },
        },
        { headers: corsHeaders },
      );
    }

    const clientLoyaltyId = clientResult.recordset[0].ClientLoyaltyID;

    // ============================================
    // 2. Build WHERE clause for filters
    // ============================================
    const whereConditions: string[] = ["ClientLoyaltyID = @clientLoyaltyId"];

    if (movementType) {
      whereConditions.push("MovementType = @movementType");
    }

    if (dateFrom) {
      whereConditions.push("CreatedAt >= @dateFrom");
    }

    if (dateTo) {
      whereConditions.push("CreatedAt <= @dateTo");
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    // ============================================
    // 3. Get total count for pagination
    // ============================================
    const countQuery = `
      SELECT COUNT(*) as total
      FROM [dbo].[TblLoyaltyPointLedger]
      ${whereClause}
    `;

    const countRequest = db
      .request()
      .input("clientLoyaltyId", sql.Int, clientLoyaltyId);
    if (movementType)
      countRequest.input("movementType", sql.NVarChar(20), movementType);
    if (dateFrom)
      countRequest.input("dateFrom", sql.DateTime, new Date(dateFrom));
    if (dateTo) countRequest.input("dateTo", sql.DateTime, new Date(dateTo));

    const countResult = await countRequest.query(countQuery);
    const totalCount = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / limit);

    // ============================================
    // 4. Get activity entries
    // ============================================
    const query = `
      SELECT 
        LedgerID,
        MovementType,
        PointsDelta,
        PointsBefore,
        PointsAfter,
        SourceInvID,
        Notes,
        CreatedAt
      FROM [dbo].[TblLoyaltyPointLedger]
      ${whereClause}
      ORDER BY CreatedAt DESC, LedgerID DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const request = db
      .request()
      .input("clientLoyaltyId", sql.Int, clientLoyaltyId);
    if (movementType)
      request.input("movementType", sql.NVarChar(20), movementType);
    if (dateFrom) request.input("dateFrom", sql.DateTime, new Date(dateFrom));
    if (dateTo) request.input("dateTo", sql.DateTime, new Date(dateTo));

    const result = await request.query(query);

    const activity: LoyaltyActivityItem[] = result.recordset.map(
      mapLedgerToActivityItem,
    );

    // ============================================
    // 5. Build Response
    // ============================================
    const response: LoyaltyActivityListResponse = {
      ok: true,
      activity,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
      },
    };

    return NextResponse.json(response, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/public/client/loyalty/activity] GET error:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load activity data" },
      { status: 500, headers: corsHeaders },
    );
  }
}
