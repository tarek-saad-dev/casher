/**
 * POST /api/operations/queue/create
 *
 * Creates a queue ticket for walk-in customer.
 * Re-runs simulation before insert to ensure validity.
 * If time changed, returns 409 with new suggestion.
 *
 * Request:
 * {
 *   empId: number,
 *   serviceIds: number[],
 *   customer: { name?: string, phone?: string },
 *   expectedStartTime: "2026-05-24T15:00:00.000Z",
 *   expectedEndTime: "2026-05-24T15:30:00.000Z",
 *   source: "walk_in"
 * }
 *
 * Response (success):
 * {
 *   ok: true,
 *   ticketCode: "W-001",
 *   queueTicketId: 123,
 *   empName: "أحمد",
 *   estimatedStartTime: "...",
 *   estimatedEndTime: "...",
 *   peopleBefore: 2
 * }
 *
 * Response (conflict - 409):
 * {
 *   ok: false,
 *   error: "الوقت لم يعد متاحاً",
 *   newSuggestion: { ...simulate result... }
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { simulateQueueInsertion, buildBarberOperationalTimeline } from "@/lib/operationsQueueTimeline";
import { getDefaultDuration, getServicesDuration, cairoDateStr } from "@/lib/queueEstimateEngine";
import { generateTicketCode } from "@/lib/queueTicketCode";

export const runtime = "nodejs";

export interface CreateQueueRequest {
  empId: number;
  serviceIds: number[];
  customer?: {
    name?: string;
    phone?: string;
  };
  expectedStartTime: string;
  expectedEndTime: string;
  source: "walk_in" | "booking" | "reschedule";
}

export interface CreateQueueResponse {
  ok: true;
  ticketCode: string;
  queueTicketId: number;
  empId: number;
  empName: string;
  estimatedStartTime: string;
  estimatedEndTime: string;
  peopleBefore: number;
  serviceDurationMinutes: number;
  services: Array<{
    proId: number;
    proName: string;
    durationMinutes: number;
  }>;
}

export async function POST(req: NextRequest) {
  const db = await getPool();
  const transaction = new sql.Transaction(db);

  try {
    const body = (await req.json()) as CreateQueueRequest;
    const {
      empId,
      serviceIds,
      customer,
      expectedStartTime,
      expectedEndTime,
      source,
    } = body;

    // Validation
    if (!empId || typeof empId !== "number") {
      return NextResponse.json(
        { ok: false, error: "empId مطلوب" },
        { status: 400 }
      );
    }

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "serviceIds مطلوب" },
        { status: 400 }
      );
    }

    if (!expectedStartTime || !expectedEndTime) {
      return NextResponse.json(
        { ok: false, error: "expectedStartTime و expectedEndTime مطلوبان" },
        { status: 400 }
      );
    }

    // Get barber info
    const empRes = await db
      .request()
      .input("eid", sql.Int, empId)
      .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
    const empName = empRes.recordset[0]?.EmpName ?? "";

    // Get service details
    const defaultDur = await getDefaultDuration(db);
    const serviceDur = await getServicesDuration(db, serviceIds, defaultDur);

    // Re-run simulation to verify time is still valid
    const simulation = await simulateQueueInsertion({
      empId,
      serviceIds,
      requestedAt: new Date().toISOString(),
    });

    if (!simulation.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: simulation.message,
          newSuggestion: simulation,
        },
        { status: 409 }
      );
    }

    // Check if requested time is still valid (within 5 minutes tolerance)
    const requestedStart = new Date(expectedStartTime).getTime();
    const suggestedStart = new Date(simulation.suggestedStartTime).getTime();
    const timeDiffMinutes = Math.abs(requestedStart - suggestedStart) / 60000;

    if (timeDiffMinutes > 5) {
      return NextResponse.json(
        {
          ok: false,
          error: "الوقت المطلوب لم يعد متاحاً، تم تحديث الجدول",
          newSuggestion: simulation,
          reason: `الوقت المقترح الآن: ${simulation.suggestedStartTime}`,
        },
        { status: 409 }
      );
    }

    // Use the simulation's suggested time (more accurate)
    const finalStartTime = simulation.suggestedStartTime;
    const finalEndTime = new Date(
      new Date(finalStartTime).getTime() + serviceDur * 60000
    ).toISOString();

    // Generate ticket code
    const dateStr = cairoDateStr(new Date());
    const ticketCode = await generateTicketCode(db, dateStr, "W");

    // Get service names
    const servicesRes = await db.request().query(`
      SELECT ProID, ProName, DurationMinutes
      FROM [dbo].[TblPro]
      WHERE ProID IN (${serviceIds.join(",")})
    `);
    const servicesMap = new Map(
      servicesRes.recordset.map((s: any) => [
        s.ProID,
        { name: s.ProName, duration: s.DurationMinutes ?? defaultDur },
      ])
    );

    // Begin transaction
    await transaction.begin();

    try {
      // 1. Create QueueTicket
      const insertTicketRes = await transaction
        .request()
        .input("ticketCode", sql.NVarChar, ticketCode)
        .input("queueDate", sql.Date, dateStr)
        .input("empId", sql.Int, empId)
        .input("status", sql.NVarChar, "waiting")
        .input("source", sql.NVarChar, source)
        .input("customerName", sql.NVarChar, customer?.name || null)
        .input("customerPhone", sql.NVarChar, customer?.phone || null)
        .input("estimatedStartTime", sql.DateTime, new Date(finalStartTime))
        .input("estimatedEndTime", sql.DateTime, new Date(finalEndTime))
        .input(
          "estimatedDurationMinutes",
          sql.Int,
          serviceDur
        ).query(`
          INSERT INTO [dbo].[QueueTickets] (
            TicketCode,
            TicketNumber,
            QueueDate,
            EmpID,
            Status,
            Source,
            CustomerName,
            CustomerPhone,
            EstimatedStartTime,
            EstimatedEndTime,
            EstimatedDurationMinutes,
            CreatedTime
          )
          OUTPUT INSERTED.QueueTicketID
          VALUES (
            @ticketCode,
            (SELECT ISNULL(MAX(TicketNumber), 0) + 1 FROM [dbo].[QueueTickets] WHERE QueueDate = @queueDate),
            @queueDate,
            @empId,
            @status,
            @source,
            @customerName,
            @customerPhone,
            @estimatedStartTime,
            @estimatedEndTime,
            @estimatedDurationMinutes,
            GETDATE()
          );
        `);

      const queueTicketId = insertTicketRes.recordset[0].QueueTicketID;

      // 2. Insert services into QueueTicketServices (if table exists)
      try {
        for (const proId of serviceIds) {
          const svc = servicesMap.get(proId);
          await transaction
            .request()
            .input("ticketId", sql.Int, queueTicketId)
            .input("proId", sql.Int, proId)
            .input("durationMin", sql.Int, svc?.duration || defaultDur)
            .query(`
              INSERT INTO [dbo].[QueueTicketServices] (QueueTicketID, ProID, DurationMinutes)
              VALUES (@ticketId, @proId, @durationMin)
            `);
        }
      } catch (svcErr) {
        // Table might not exist - non-fatal
        console.log("[queue/create] QueueTicketServices insert skipped:", svcErr);
      }

      await transaction.commit();

      const response: CreateQueueResponse = {
        ok: true,
        ticketCode,
        queueTicketId,
        empId,
        empName,
        estimatedStartTime: finalStartTime,
        estimatedEndTime: finalEndTime,
        peopleBefore: simulation.peopleBefore,
        serviceDurationMinutes: serviceDur,
        services: serviceIds.map((id) => {
          const svc = servicesMap.get(id);
          return {
            proId: id,
            proName: svc?.name || `Service ${id}`,
            durationMinutes: svc?.duration || defaultDur,
          };
        }),
      };

      return NextResponse.json(response);
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("[operations/queue/create] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "فشل في إنشاء الدور",
      },
      { status: 500 }
    );
  }
}
