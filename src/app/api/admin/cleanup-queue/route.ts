/**
 * POST /api/admin/cleanup-queue
 *
 * Cleanup test queue tickets (soft cancel only)
 * For testing purposes only - remove in production
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool, sql } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const body = await req.json().catch(() => ({}));
    const { ticketCode, ticketPrefix, ticketNumber, empId } = body;

    const db = await getPool();

    // Build WHERE clause based on provided criteria
    let whereClause = "";
    const whereConditions: string[] = [];

    if (ticketCode) {
      whereConditions.push(`TicketCode = @ticketCode`);
    }
    if (ticketPrefix && ticketNumber !== undefined) {
      whereConditions.push(`(TicketPrefix = @ticketPrefix AND TicketNumber = @ticketNumber)`);
    }
    if (empId) {
      whereConditions.push(`EmpID = @empId`);
    }

    if (whereConditions.length === 0) {
      return NextResponse.json(
        { error: "يجب توفير ticketCode أو ticketPrefix+ticketNumber أو empId" },
        { status: 400 }
      );
    }

    whereClause = whereConditions.join(" OR ");

    // Step 1: Find before update
    const findRequest = db.request();
    if (ticketCode) findRequest.input("ticketCode", sql.NVarChar, ticketCode);
    if (ticketPrefix) findRequest.input("ticketPrefix", sql.NVarChar, ticketPrefix);
    if (ticketNumber !== undefined) findRequest.input("ticketNumber", sql.Int, ticketNumber);
    if (empId) findRequest.input("empId", sql.Int, empId);

    const beforeQuery = `
      SELECT 
        QueueTicketID,
        TicketCode,
        TicketNumber,
        TicketPrefix,
        EmpID,
        QueueDate,
        Status,
        EstimatedStartTime,
        CancelledAt,
        ClientID,
        Source
      FROM dbo.QueueTickets
      WHERE ${whereClause}
      ORDER BY QueueTicketID;
    `;

    const beforeRes = await findRequest.query(beforeQuery);
    const before = beforeRes.recordset;

    if (before.length === 0) {
      return NextResponse.json({
        ok: false,
        message: "لم يتم العثور على أي دور مطابق",
        criteria: { ticketCode, ticketPrefix, ticketNumber, empId },
      });
    }

    // Check statuses
    const activeItems = before.filter((item: { Status: string }) => 
      ['waiting', 'called'].includes(item.Status?.toLowerCase())
    );
    const inServiceItems = before.filter((item: { Status: string }) => 
      item.Status?.toLowerCase() === 'in_service'
    );
    const alreadyDone = before.filter((item: { Status: string }) => 
      ['cancelled', 'done', 'completed', 'skipped', 'no_show'].includes(item.Status?.toLowerCase())
    );

    // Step 2: Soft cancel only active items (waiting/called)
    let updatedCount = 0;
    if (activeItems.length > 0) {
      const updateRequest = db.request();
      if (ticketCode) updateRequest.input("ticketCode", sql.NVarChar, ticketCode);
      if (ticketPrefix) updateRequest.input("ticketPrefix", sql.NVarChar, ticketPrefix);
      if (ticketNumber !== undefined) updateRequest.input("ticketNumber", sql.Int, ticketNumber);
      if (empId) updateRequest.input("empId", sql.Int, empId);

      const updateQuery = `
        UPDATE dbo.QueueTickets
        SET 
          Status = 'cancelled',
          CancelledAt = GETDATE(),
          CancelReason = 'Admin cleanup'
        WHERE 
          (${whereClause})
          AND Status IN ('waiting', 'called');
        
        SELECT @@ROWCOUNT as updatedCount;
      `;

      const updateRes = await updateRequest.query(updateQuery);
      updatedCount = updateRes.recordset[0]?.updatedCount || 0;
    }

    // Step 3: Verify after update
    const afterRequest = db.request();
    if (ticketCode) afterRequest.input("ticketCode", sql.NVarChar, ticketCode);
    if (ticketPrefix) afterRequest.input("ticketPrefix", sql.NVarChar, ticketPrefix);
    if (ticketNumber !== undefined) afterRequest.input("ticketNumber", sql.Int, ticketNumber);
    if (empId) afterRequest.input("empId", sql.Int, empId);

    const afterQuery = `
      SELECT 
        QueueTicketID,
        TicketCode,
        TicketNumber,
        TicketPrefix,
        EmpID,
        QueueDate,
        Status,
        EstimatedStartTime,
        CancelledAt
      FROM dbo.QueueTickets
      WHERE ${whereClause}
      ORDER BY QueueTicketID;
    `;

    const afterRes = await afterRequest.query(afterQuery);
    const after = afterRes.recordset;

    // Step 4: Check active blockers for empId (if provided)
    let activeBlockers: unknown[] = [];
    if (empId) {
      const blockersRes = await db.request()
        .input("empId", sql.Int, empId)
        .query(`
          SELECT 
            QueueTicketID,
            TicketCode,
            Status,
            EstimatedStartTime
          FROM dbo.QueueTickets
          WHERE EmpID = @empId
            AND QueueDate = CAST(GETDATE() AS DATE)
            AND Status IN ('waiting', 'called', 'in_service')
          ORDER BY EstimatedStartTime;
        `);
      activeBlockers = blockersRes.recordset;
    }

    return NextResponse.json({
      ok: true,
      summary: {
        found: before.length,
        activeBefore: activeItems.length,
        inService: inServiceItems.length,
        alreadyDone: alreadyDone.length,
        cancelled: updatedCount,
      },
      before: before.map((item: { QueueTicketID: number; TicketCode: string; Status: string }) => ({
        id: item.QueueTicketID,
        code: item.TicketCode,
        status: item.Status,
      })),
      after: after.map((item: { QueueTicketID: number; TicketCode: string; Status: string; CancelledAt: Date | null }) => ({
        id: item.QueueTicketID,
        code: item.TicketCode,
        status: item.Status,
        cancelledAt: item.CancelledAt,
      })),
      activeBlockersForEmp: empId ? {
        empId,
        count: activeBlockers.length,
        items: activeBlockers,
      } : null,
      simulateExpected: {
        peopleBefore: activeBlockers.length,
        note: "لو مفيش حجوزات active برضه",
      },
    });

  } catch (err) {
    console.error("[cleanup-queue] error:", err);
    return NextResponse.json(
      { error: "فشل تنفيذ cleanup", details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// For GET requests - just show instructions
export async function GET() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  return NextResponse.json({
    instructions: "Use POST to cleanup queue tickets",
    examples: {
      byTicketCode: {
        method: "POST",
        body: { ticketCode: "W-001" },
      },
      byPrefixAndNumber: {
        method: "POST", 
        body: { ticketPrefix: "W", ticketNumber: 1 },
      },
      byEmpId: {
        method: "POST",
        body: { empId: 25 },
        note: "This will cancel ALL active queue tickets for this employee!",
      },
    },
    note: "Only tickets with Status='waiting' or 'called' will be cancelled. In-service tickets require manual handling.",
  });
}
