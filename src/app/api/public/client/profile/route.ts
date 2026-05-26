/**
 * POST /api/public/client/profile
 * Returns client profile from TblClient by phone number.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { PUBLIC_CORS_HEADERS } from "@/lib/publicBookingHelpers";

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "").replace(/^\+20/, "0");
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const phone = body.phone;

    if (!phone || typeof phone !== "string") {
      return NextResponse.json(
        { ok: false, error: "Phone number is required" },
        { status: 400, headers: PUBLIC_CORS_HEADERS }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 10) {
      return NextResponse.json(
        { ok: false, error: "Invalid phone number" },
        { status: 400, headers: PUBLIC_CORS_HEADERS }
      );
    }

    const db = await getPool();

    const result = await db
      .request()
      .input("mobile", normalizedPhone)
      .query(`
        SELECT
          c.ClientID   AS id,
          c.Name       AS name,
          c.Mobile     AS phone,
          CONVERT(VARCHAR(10), c.RegisterDate, 120) AS registeredAt
        FROM dbo.TblClient c
        WHERE c.Mobile = @mobile
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Client not found" },
        { status: 404, headers: PUBLIC_CORS_HEADERS }
      );
    }

    const client = result.recordset[0];

    return NextResponse.json(
      {
        ok: true,
        client: {
          id: client.id,
          name: client.name,
          phone: client.phone,
          registeredAt: client.registeredAt,
        },
      },
      { headers: PUBLIC_CORS_HEADERS }
    );
  } catch (err: unknown) {
    console.error("[public/client/profile] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch client profile" },
      { status: 500, headers: PUBLIC_CORS_HEADERS }
    );
  }
}
