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
 *   customer: {
 *     clientId?: number,  // If provided, linked directly
 *     name?: string,      // Used if clientId not provided
 *     phone?: string      // Used to lookup/create customer
 *   },
 *   expectedStartTime: "2026-05-24T15:00:00.000Z",
 *   expectedEndTime: "2026-05-24T15:30:00.000Z",
 *   source: "walk_in"
 * }
 *
 * Customer handling:
 * - If clientId provided: Uses it directly
 * - If phone matches existing: Links to existing customer
 * - If phone not found + name provided: Creates new customer then links
 * - If no customer data: Creates as "walk-in" with no client link
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
import { detectQueueTicketsSchema, buildInsertColumns } from "@/lib/queueSchema";
import { getChairNumber } from "@/lib/chairMapping";

export const runtime = "nodejs";

export interface CreateQueueRequest {
  empId: number;
  serviceIds: number[];
  customer?: {
    clientId?: number;
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
  ticketNumber: number;
  ticketPrefix: string;
  queueTicketId: number;
  queueDate: string;
  empId: number;
  empName: string;
  chairNumber: number | null;
  customer: {
    clientId: number | null;
    name: string | null;
    phone: string | null;
  };
  services: Array<{
    proId: number;
    proName: string;
    durationMinutes: number;
    price?: number;
  }>;
  serviceDurationMinutes: number;
  estimatedStartTime: string;
  estimatedEndTime: string;
  estimatedWaitMinutes: number;
  peopleBefore: number;
  status: string;
  createdAt: string;
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

    // Detect schema to avoid using non-existent columns
    const schema = await detectQueueTicketsSchema();
    console.log("[queue/create] Schema detected:", schema);

    // Calculate estimatedWaitMinutes (difference between now and start time)
    const nowMs = new Date().getTime();
    const startMs = new Date(finalStartTime).getTime();
    const estimatedWaitMinutes = Math.max(0, Math.round((startMs - nowMs) / 60000));

    // Build dynamic insert based on actual schema
    const { columns, paramNames } = buildInsertColumns(schema);

    // Begin transaction
    await transaction.begin();

    try {
      // 1. Resolve customer to ClientID
      let clientId: number | null = null;
      let resolvedCustomerName = customer?.name || null;
      let resolvedCustomerPhone = customer?.phone || null;

      // If customer has clientId, use it directly
      if (customer?.clientId && schema.hasClientID) {
        clientId = customer.clientId;
      }
      // Otherwise try to find or create customer
      else if (customer?.phone) {
        try {
          // Search for customer by phone in TblClient
          const findClient = await transaction.request()
            .input("phone", sql.NVarChar, customer.phone)
            .query(`
              SELECT TOP 1 ClientID, Name, Mobile
              FROM [dbo].[TblClient]
              WHERE Mobile = @phone OR Mobile2 = @phone
            `);

          if (findClient.recordset.length > 0) {
            clientId = findClient.recordset[0].ClientID;
            resolvedCustomerName = findClient.recordset[0].Name;
            resolvedCustomerPhone = findClient.recordset[0].Mobile;
          }
          // If not found and has name, create new customer
          else if (customer.name && schema.hasClientID) {
            const createClient = await transaction.request()
              .input("name", sql.NVarChar, customer.name)
              .input("phone", sql.NVarChar, customer.phone)
              .query(`
                INSERT INTO [dbo].[TblClient] (Name, Mobile)
                OUTPUT INSERTED.ClientID
                VALUES (@name, @phone);
              `);
            if (createClient.recordset.length > 0) {
              clientId = createClient.recordset[0].ClientID;
            }
          }
        } catch (clientErr) {
          console.log("[queue/create] Customer lookup/creation skipped:", clientErr);
          // Continue without clientId
        }
      }

      // 2. Create QueueTicket with dynamic columns
      const insertColumnsStr = columns.join(', ');
      const insertValuesStr = paramNames.join(', ');

      // Build request with all inputs
      const ticketRequest = transaction
        .request()
        .input("ticketCode", sql.NVarChar, ticketCode)
        .input("queueDate", sql.Date, dateStr)
        .input("empId", sql.Int, empId)
        .input("status", sql.NVarChar, "waiting")
        .input("source", sql.NVarChar, source)
        .input("estimatedStartTime", sql.DateTime, new Date(finalStartTime));

      // Add optional column inputs if they exist in schema
      if (schema.hasTicketPrefix) {
        ticketRequest.input("ticketPrefix", sql.NVarChar, "W");
      }
      if (schema.hasClientID) {
        ticketRequest.input("clientId", sql.Int, clientId);
      }
      // Only add CustomerName/CustomerPhone if columns exist
      if (schema.hasCustomerName) {
        ticketRequest.input("customerName", sql.NVarChar, resolvedCustomerName);
      }
      if (schema.hasCustomerPhone) {
        ticketRequest.input("customerPhone", sql.NVarChar, resolvedCustomerPhone);
      }
      if (schema.hasPriority) {
        ticketRequest.input("priority", sql.Int, 0);
      }
      if (schema.hasEstimatedWaitMinutes) {
        ticketRequest.input("estimatedWaitMinutes", sql.Int, estimatedWaitMinutes);
      }
      if (schema.hasWaitingCountAtCreation) {
        ticketRequest.input("waitingCountAtCreation", sql.Int, simulation.peopleBefore);
      }
      if (schema.hasNotes) {
        ticketRequest.input("notes", sql.NVarChar, resolvedCustomerName || null);
      }

      const insertQuery = `
        INSERT INTO [dbo].[QueueTickets] (
          ${insertColumnsStr}
        )
        OUTPUT INSERTED.QueueTicketID
        VALUES (
          ${insertValuesStr}
        );
      `;

      console.log("[queue/create] Insert query:", insertQuery);
      console.log("[queue/create] Columns:", insertColumnsStr);
      console.log("[queue/create] ClientID:", clientId);

      const insertTicketRes = await ticketRequest.query(insertQuery);

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

      // Calculate estimatedEndTime in code only (not stored in DB)
      const responseEndTime = new Date(
        new Date(finalStartTime).getTime() + serviceDur * 60000
      ).toISOString();

      // Extract ticket number from code (e.g., "W-002" -> 2)
      const ticketNumberMatch = ticketCode.match(/-(\d+)$/);
      const ticketNumber = ticketNumberMatch ? parseInt(ticketNumberMatch[1], 10) : 0;

      // Get chair number for the barber
      const chairNumber = getChairNumber(empName);

      const response: CreateQueueResponse = {
        ok: true,
        ticketCode,
        ticketNumber,
        ticketPrefix: "W",
        queueTicketId,
        queueDate: dateStr,
        empId,
        empName,
        chairNumber,
        customer: {
          clientId,
          name: resolvedCustomerName,
          phone: resolvedCustomerPhone,
        },
        services: serviceIds.map((id) => {
          const svc = servicesMap.get(id);
          return {
            proId: id,
            proName: svc?.name || `Service ${id}`,
            durationMinutes: svc?.duration || defaultDur,
            price: undefined, // Could be fetched from DB if needed
          };
        }),
        serviceDurationMinutes: serviceDur,
        estimatedStartTime: finalStartTime,
        estimatedEndTime: responseEndTime,
        estimatedWaitMinutes,
        peopleBefore: simulation.peopleBefore,
        status: "waiting",
        createdAt: new Date().toISOString(),
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
