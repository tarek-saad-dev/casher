import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';

export const runtime = "nodejs";

/**
 * POST /api/admin/booking-debug/zeyad-1130-test/plan-test
 *
 * Tests /booking/plan for the 23:30 slot to ensure it returns 409
 * for duplicate booking attempt.
 *
 * ⚠️ TEMPORARY DEBUG ENDPOINT - REMOVE AFTER TESTING
 */
export async function POST(req: NextRequest) {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const baseUrl = req.nextUrl.origin;

    // Test parameters
    const testPayload = {
      customer: {
        name: "Test Customer",
        phone: "01234567890",
      },
      serviceIds: [1047],
      date: "2026-05-23",
      time: "23:30",
      dayOffset: 0,
      mode: "specific",
      empId: 12,
      notes: "Test booking - should fail if slot is taken",
    };

    console.log("========================================");
    console.log("Testing /booking/plan for 23:30 slot");
    console.log("========================================");
    console.log("Payload:", JSON.stringify(testPayload, null, 2));

    // Call /booking/plan
    const planUrl = `${baseUrl}/api/public/booking/plan`;
    console.log(`\nCalling: ${planUrl}`);

    const response = await fetch(planUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testPayload),
    });

    const data = await response.json();

    console.log("\nResponse Status:", response.status);
    console.log("Response Data:", JSON.stringify(data, null, 2));

    // Analyze result
    const is409 = response.status === 409;
    const is201 = response.status === 201;
    const hasBookingConflict =
      data.reason === "booking_conflict" ||
      data.conflictType === "booking" ||
      data.debug?.hasBookingConflict === true;

    console.log("\n========================================");
    console.log("ANALYSIS:");
    console.log("========================================");
    console.log({
      is409,
      is201,
      hasBookingConflict,
      expectedBehavior: "Should return 409 with booking_conflict reason",
      actualBehavior: is409
        ? "CORRECT: Returns 409 conflict"
        : is201
          ? "BUG: Created duplicate booking!"
          : `UNEXPECTED: Status ${response.status}`,
    });

    return NextResponse.json({
      test: "/booking/plan 23:30 slot test",
      payload: testPayload,
      result: {
        status: response.status,
        ok: data.ok,
        error: data.error,
        reason: data.reason,
        conflictType: data.conflictType,
        debug: data.debug,
        conflictingBooking: data.conflictingBooking,
      },
      analysis: {
        is409,
        is201,
        hasBookingConflict,
        expected: "409 booking_conflict",
        passed: is409 && hasBookingConflict,
        bugDetected: is201, // If we got 201, we created a duplicate!
      },
    });
  } catch (err: any) {
    console.error("[plan-test] error:", err);
    return NextResponse.json(
      { error: err?.message || "Test failed" },
      { status: 500 },
    );
  }
}
