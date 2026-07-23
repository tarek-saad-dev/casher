import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  buildQueueIntervals,
  buildBookingIntervals,
  findFirstFreeSlot,
  getDefaultDuration,
  getServicesDuration,
  countQueueCustomersAhead,
} from "@/lib/queueEstimateEngine";
import { getCairoBusinessDate } from "@/lib/businessDate";
import {
  computeEffectiveTickets,
  type QueueTicketRaw,
} from "@/lib/queueLifecycleEngine";
import { getBarberAvailabilityReason } from "@/lib/barberAvailability";
import {
  requireActiveBranchContext,
  requireBranchOperationAccess,
  isActiveBranchContext,
} from "@/lib/branch/context";
import { detectQueueTicketsSchema } from "@/lib/queueSchema";
import { isEmployeeEligibleForBranchBookings } from "@/lib/branch/bookingQueueOwnership";

export const runtime = "nodejs";

// ── Shared: run idempotent migration for estimate columns ────────────────────
async function ensureEstimateColumns(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<void> {
  try {
    await db.request().query(`
      IF COL_LENGTH('dbo.QueueTickets', 'EstimatedStartTime') IS NULL
        ALTER TABLE dbo.QueueTickets ADD EstimatedStartTime DATETIME2 NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'EstimatedWaitMinutes') IS NULL
        ALTER TABLE dbo.QueueTickets ADD EstimatedWaitMinutes INT NULL;
      IF COL_LENGTH('dbo.QueueTickets', 'WaitingCountAtCreation') IS NULL
        ALTER TABLE dbo.QueueTickets ADD WaitingCountAtCreation INT NULL;
    `);
  } catch (e) {
    console.warn("[queue] ensureEstimateColumns failed (non-fatal):", e);
  }
}

// ── Cached column presence (per process lifetime) ─────────────────────────────
let _estimateColsVerified = false;

async function getEstimateColsSelect(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<string> {
  if (!_estimateColsVerified) {
    await ensureEstimateColumns(db);
    _estimateColsVerified = true;
  }
  // After migration attempt, check what actually exists
  try {
    const check = await db.request().query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'QueueTickets'
        AND COLUMN_NAME IN ('EstimatedStartTime','EstimatedWaitMinutes','WaitingCountAtCreation')
    `);
    if (check.recordset[0]?.cnt === 3) {
      return `qt.EstimatedStartTime,
        qt.EstimatedWaitMinutes,
        qt.WaitingCountAtCreation`;
    }
  } catch {
    /* fallthrough */
  }
  // Columns still missing — use NULL aliases so query doesn't crash
  return `CAST(NULL AS DATETIME2) AS EstimatedStartTime,
        CAST(NULL AS INT) AS EstimatedWaitMinutes,
        CAST(NULL AS INT) AS WaitingCountAtCreation`;
}

// ── Lifecycle columns (ExpectedStartAt, ExpectedEndAt, DurationMinutes, etc.) ─
async function getLifecycleColsSelect(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<string> {
  try {
    const check = await db.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'QueueTickets'
        AND COLUMN_NAME IN ('ExpectedStartAt','ExpectedEndAt','DurationMinutes','LastStatusChangedAt','AutoClosedAt','AutoCloseReason')
    `);
    const cols = new Set(check.recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME));

    const parts: string[] = [];
    parts.push(cols.has('ExpectedStartAt') ? 'qt.ExpectedStartAt' : 'CAST(NULL AS DATETIME2) AS ExpectedStartAt');
    parts.push(cols.has('ExpectedEndAt') ? 'qt.ExpectedEndAt' : 'CAST(NULL AS DATETIME2) AS ExpectedEndAt');
    parts.push(cols.has('DurationMinutes') ? 'qt.DurationMinutes' : 'CAST(NULL AS INT) AS DurationMinutes');
    parts.push(cols.has('LastStatusChangedAt') ? 'qt.LastStatusChangedAt' : 'CAST(NULL AS DATETIME2) AS LastStatusChangedAt');
    parts.push(cols.has('AutoClosedAt') ? 'qt.AutoClosedAt' : 'CAST(NULL AS DATETIME2) AS AutoClosedAt');
    parts.push(cols.has('AutoCloseReason') ? 'qt.AutoCloseReason' : 'CAST(NULL AS NVARCHAR(100)) AS AutoCloseReason');
    return parts.join(',\n        ');
  } catch {
    return `CAST(NULL AS DATETIME2) AS ExpectedStartAt,
        CAST(NULL AS DATETIME2) AS ExpectedEndAt,
        CAST(NULL AS INT) AS DurationMinutes,
        CAST(NULL AS DATETIME2) AS LastStatusChangedAt,
        CAST(NULL AS DATETIME2) AS AutoClosedAt,
        CAST(NULL AS NVARCHAR(100)) AS AutoCloseReason`;
  }
}

// GET /api/queue?date=YYYY-MM-DD&empId=&status=
export async function GET(req: NextRequest) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(req.url);
    const date =
      searchParams.get("date") || getCairoBusinessDate();
    const empId = searchParams.get("empId");
    const status = searchParams.get("status");

    const db = await getPool();

    // Guard: table might not exist on first run
    const tableCheck = await db
      .request()
      .query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='QueueTickets'`,
      );
    if (!tableCheck.recordset.length) {
      console.warn("[queue GET] QueueTickets table not found");
      return NextResponse.json({ tickets: [] });
    }

    // Ensure estimate columns exist (idempotent) — falls back to NULL aliases if migration fails
    const estColsSql = await getEstimateColsSelect(db);
    const schema = await detectQueueTicketsSchema();

    const request = db.request().input("date", sql.Date, date);
    let where = "qt.QueueDate = @date";
    if (schema.hasBranchID) {
      request.input("branchId", sql.Int, branch.branchId);
      where += " AND qt.BranchID = @branchId";
    }
    if (empId) {
      request.input("empId", sql.Int, parseInt(empId));
      where += " AND qt.EmpID = @empId";
    }
    if (status && status !== "all") {
      request.input("status", sql.NVarChar, status);
      where += " AND qt.Status = @status";
    }

    // Build lifecycle columns SQL (safely handles missing columns)
    const lifecycleCols = await getLifecycleColsSelect(db);

    const result = await request.query(`
      SELECT
        qt.QueueTicketID, qt.TicketCode, qt.TicketNumber, qt.TicketPrefix,
        qt.ClientID, qt.EmpID, qt.BookingID, qt.QueueDate, qt.CreatedTime,
        qt.Status, qt.Source, qt.Priority,
        qt.CalledAt, qt.ArrivedAt, qt.ServiceStartedAt, qt.ServiceEndedAt, qt.CancelledAt,
        qt.Notes,
        ${estColsSql},
        ${lifecycleCols},
        c.[Name]  AS ClientName,
        c.Mobile  AS ClientMobile,
        e.EmpName
      FROM [dbo].[QueueTickets] qt
      LEFT JOIN [dbo].[TblClient] c ON c.ClientID = qt.ClientID
      LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = qt.EmpID
      WHERE ${where}
      ORDER BY qt.Priority DESC, qt.TicketNumber ASC
    `);

    // Compute effective status for each ticket
    const now = new Date();
    const effectiveTickets = computeEffectiveTickets(
      result.recordset as QueueTicketRaw[],
      now,
    );

    return NextResponse.json({
      tickets: effectiveTickets,
      businessDate: date,
    });
  } catch (err) {
    console.error("[queue GET]", err);
    return NextResponse.json(
      { error: "فشل تحميل قائمة الانتظار" },
      { status: 500 },
    );
  }
}

// POST /api/queue — create new queue ticket
export async function POST(req: NextRequest) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const session = await getSession();
    const userID = session?.UserID ?? 0;
    const body = await req.json();
    const {
      clientId,
      empId,
      notes,
      priority = 0,
      bookingId = null,
      services = [],
      estimatedStartTime = null,
      estimatedWaitMinutes = null,
      waitingCountAtCreation = null,
      forceManualPriority = false,
    } = body as {
      clientId?: number | null;
      empId?: number | null;
      notes?: string | null;
      priority?: number;
      bookingId?: number | null;
      services?: Array<{
        proId?: number;
        proName?: string;
        qty?: number;
        price?: number;
        durationMinutes?: number;
      }>;
      estimatedStartTime?: string | null;
      estimatedWaitMinutes?: number | null;
      waitingCountAtCreation?: number | null;
      forceManualPriority?: boolean;
    };

    console.log("[queue POST] received", {
      clientId,
      empId,
      servicesCount: services.length,
      serviceIds: services.map((s) => s.proId),
      notes,
      estimatedStartTime,
      estimatedWaitMinutes,
      waitingCountAtCreation,
    });

    const db = await getPool();

    // Guard: verify required tables exist
    const tableCheck = await db.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME IN ('QueueTickets','QueueBookingSettings')
    `);
    const found = tableCheck.recordset.map(
      (r: { TABLE_NAME: string }) => r.TABLE_NAME,
    );
    if (!found.includes("QueueTickets")) {
      console.error(
        "[queue POST] QueueTickets table not found in current database",
      );
      return NextResponse.json(
        { error: "جدول التذاكر غير موجود — يرجى تشغيل الميجرشين" },
        { status: 503 },
      );
    }

    // Load settings safely
    let prefix = "A";
    let startNumber = 1;
    if (found.includes("QueueBookingSettings")) {
      const settRes = await db.request().query(`
        SELECT TOP 1 QueuePrefix, QueueStartNumber FROM [dbo].[QueueBookingSettings]
      `);
      if (settRes.recordset.length) {
        prefix = settRes.recordset[0].QueuePrefix ?? "A";
        startNumber = settRes.recordset[0].QueueStartNumber ?? 1;
      }
    }

    const now2 = new Date();
    const today = getCairoBusinessDate(now2);
    const createdTime = now2.toLocaleTimeString("en-GB", {
      timeZone: "Africa/Cairo",
      hour12: false,
    });

    // ── Guard: day_off / overrides / attendance check ─────────────────────────
    // Must be done BEFORE the interval math so a day_off barber is rejected outright.
    if (empId) {
      const guardNow = new Date();
      const avail = await getBarberAvailabilityReason(empId, guardNow);
      if (!avail.available) {
        return NextResponse.json(
          { error: avail.reason ?? "الحلاق غير متاح", reason: "barber_unavailable" },
          { status: 409 },
        );
      }
      const eligible = await isEmployeeEligibleForBranchBookings({
        empId,
        branchId: branch.branchId,
        operationalDate: today,
      });
      if (!eligible) {
        return NextResponse.json(
          { error: "الموظف غير مرتبط بهذا الفرع", reason: "employee_not_assigned_to_branch" },
          { status: 409 },
        );
      }
    }

    // ── Re-calculate estimate server-side inside a SERIALIZABLE transaction ──
    // This prevents two concurrent requests from getting the same slot.
    const defaultDur = await getDefaultDuration(db);
    const serviceProIds = services
      .map((s) => s.proId)
      .filter((id): id is number => !!id);
    const customerDur = await getServicesDuration(
      db,
      serviceProIds,
      defaultDur,
    );

    // Compute estimate BEFORE opening the transaction (read-only)
    let finalEstStart: Date | null = null;
    let finalEstWait: number | null = null;
    let finalWaitCount: number | null = null;

    if (empId) {
      const qIvs = await buildQueueIntervals(
        db,
        empId,
        today,
        now2,
        defaultDur,
        undefined,
        { filterStale: true, graceMinutes: 30, debugContext: "queue-create" }
      );
      const bIvs = await buildBookingIntervals(db, empId, today, defaultDur);
      const allIvs = [...qIvs, ...bIvs].sort(
        (a, b) => a.start.getTime() - b.start.getTime(),
      );
      finalEstStart = findFirstFreeSlot(now2, customerDur, allIvs);
      finalEstWait = Math.max(
        0,
        Math.round((finalEstStart.getTime() - now2.getTime()) / 60000),
      );
      finalWaitCount = countQueueCustomersAhead(qIvs, finalEstStart);
      console.log(
        "[queue create] final estimatedStartTime saved",
        finalEstStart.toISOString(),
        "waitMin",
        finalEstWait,
        "queueBefore",
        finalWaitCount,
      );

      // ── Comprehensive Conflict Check (walk-in only) ─────────────────────────
      // CRITICAL: Validate proposed interval against ALL bookings and ALL queue tickets
      // Correct overlap condition: newStart < existingEnd && newEnd > existingStart
      if (!bookingId && finalEstStart) {
        const proposedStart = finalEstStart;
        const proposedEnd = new Date(proposedStart.getTime() + customerDur * 60000);

        // Log proposed interval
        console.log("[queue create] Conflict check - proposed interval:", {
          proposedStart: proposedStart.toISOString(),
          proposedEnd: proposedEnd.toISOString(),
          duration: customerDur,
        });

        // Log existing intervals
        console.log("[queue create] Conflict check - existing booking intervals:", bIvs.map(b => ({
          id: b.id,
          start: b.start.toISOString(),
          end: b.end.toISOString(),
        })));
        console.log("[queue create] Conflict check - existing queue intervals:", qIvs.map(q => ({
          id: q.id,
          code: q.ticketCode,
          start: q.start.toISOString(),
          end: q.end.toISOString(),
        })));

        // Check overlap with ALL bookings (not just upcoming)
        const bookingConflicts = bIvs.filter(b =>
          proposedStart < b.end && proposedEnd > b.start
        );

        // Check overlap with ALL queue tickets
        const queueConflicts = qIvs.filter(q =>
          proposedStart < q.end && proposedEnd > q.start
        );

        // Log conflicts
        console.log("[queue create] Conflict check results:", {
          bookingConflicts: bookingConflicts.map(b => ({ id: b.id, start: b.start.toISOString(), end: b.end.toISOString() })),
          queueConflicts: queueConflicts.map(q => ({ id: q.id, code: q.ticketCode, start: q.start.toISOString(), end: q.end.toISOString() })),
          hasConflict: bookingConflicts.length > 0 || queueConflicts.length > 0,
        });

        if ((bookingConflicts.length > 0 || queueConflicts.length > 0) && !forceManualPriority) {
          // Find the next available slot after all conflicts
          const allConflicts = [...bookingConflicts, ...queueConflicts].sort(
            (a, b) => a.end.getTime() - b.end.getTime()
          );
          const lastConflictEnd = allConflicts[allConflicts.length - 1]?.end;
          const suggestedStart = lastConflictEnd || proposedStart;

          // Load details for first booking conflict (for error message)
          let conflictDetails: Array<{ id: number; type: string; start: string; end: string; clientName?: string }> = [];

          if (bookingConflicts.length > 0) {
            const firstBooking = bookingConflicts[0];
            const bookingRes = await db
              .request()
              .input("bid", sql.Int, firstBooking.id)
              .query(`
                SELECT b.BookingID, b.StartTime, b.EndTime, c.Name AS ClientName
                FROM [dbo].[Bookings] b
                LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
                WHERE b.BookingID = @bid
              `);
            const bRow = bookingRes.recordset[0];
            if (bRow) {
              conflictDetails.push({
                id: bRow.BookingID,
                type: "booking",
                start: firstBooking.start.toISOString(),
                end: firstBooking.end.toISOString(),
                clientName: bRow.ClientName,
              });
            }
          }

          for (const q of queueConflicts.slice(0, 3)) {
            conflictDetails.push({
              id: q.id,
              type: "queue",
              start: q.start.toISOString(),
              end: q.end.toISOString(),
              clientName: undefined,
            });
          }

          return NextResponse.json(
            {
              error: "conflicts_with_existing_items",
              message: bookingConflicts.length > 0
                ? `الدور الجديد يتعارض مع ${bookingConflicts.length > 1 ? 'حجوزات' : 'حجز'} موجودة`
                : `الدور الجديد يتعارض مع ${queueConflicts.length > 1 ? 'أدوار' : 'دور'} موجودة`,
              conflictDetails,
              bookingConflicts: bookingConflicts.map(b => ({
                bookingId: b.id,
                startTime: b.start.toISOString(),
                endTime: b.end.toISOString(),
              })),
              queueConflicts: queueConflicts.map(q => ({
                ticketId: q.id,
                ticketCode: q.ticketCode,
                startTime: q.start.toISOString(),
                endTime: q.end.toISOString(),
              })),
              requiredDurationMinutes: customerDur,
              suggestedStartAfterConflict: suggestedStart.toISOString(),
              requiresForceFlag: true,
            },
            { status: 409 },
          );
        }

        console.log("[queue create] Conflict check passed - no overlaps detected");
      }
    }

    // Compute next ticket number inside a serializable transaction to avoid race conditions
    const transaction = db.transaction();
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    let newId: number;
    let ticketCode: string;
    let ticketNumber: number;

    try {
      const tr = transaction.request().input("qDate", sql.Date, today);
      const schema = await detectQueueTicketsSchema();
      if (schema.hasBranchID) tr.input("branchIdTx", sql.Int, branch.branchId);
      const numRes = await tr.query(`
          SELECT ISNULL(MAX(TicketNumber), ${startNumber - 1}) + 1 AS NextNum
          FROM [dbo].[QueueTickets] WITH (UPDLOCK, HOLDLOCK)
          WHERE QueueDate = @qDate
            ${schema.hasBranchID ? "AND BranchID = @branchIdTx" : ""}
        `);
      ticketNumber = numRes.recordset[0].NextNum;
      ticketCode = `${prefix}${ticketNumber}`;

      // Inside transaction: re-verify estimate is still valid (lock held)
      // If another ticket was inserted concurrently, recalculate.
      if (empId && finalEstStart) {
        const qIvsTx = await buildQueueIntervals(
          db,
          empId,
          today,
          now2,
          defaultDur,
          undefined,
          { filterStale: true, graceMinutes: 30, debugContext: "queue-create-tx" }
        );
        const bIvsTx = await buildBookingIntervals(
          db,
          empId,
          today,
          defaultDur,
        );
        const allIvsTx = [...qIvsTx, ...bIvsTx].sort(
          (a, b) => a.start.getTime() - b.start.getTime(),
        );
        const verifiedSlot = findFirstFreeSlot(now2, customerDur, allIvsTx);

        // CRITICAL: Re-check for conflicts with the verified slot inside transaction
        const verifiedEnd = new Date(verifiedSlot.getTime() + customerDur * 60000);
        const txBookingConflicts = bIvsTx.filter(b =>
          verifiedSlot < b.end && verifiedEnd > b.start
        );
        const txQueueConflicts = qIvsTx.filter(q =>
          verifiedSlot < q.end && verifiedEnd > q.start
        );

        console.log("[queue create] Transaction conflict check:", {
          verifiedSlot: verifiedSlot.toISOString(),
          verifiedEnd: verifiedEnd.toISOString(),
          bookingConflicts: txBookingConflicts.length,
          queueConflicts: txQueueConflicts.length,
        });

        // If conflicts detected inside transaction, abort
        if (!bookingId && (txBookingConflicts.length > 0 || txQueueConflicts.length > 0) && !forceManualPriority) {
          await transaction.rollback();
          console.log("[queue create] Transaction rolled back due to conflicts");
          return NextResponse.json(
            {
              error: "conflicts_detected_in_transaction",
              message: "تم اكتشاف تعارض أثناء إنشاء الدور، يرجى المحاولة مرة أخرى",
              requiresForceFlag: true,
            },
            { status: 409 },
          );
        }

        // Only update if slot changed significantly (> 1 min diff)
        if (
          Math.abs(verifiedSlot.getTime() - finalEstStart.getTime()) > 60000
        ) {
          finalEstStart = verifiedSlot;
          finalEstWait = Math.max(
            0,
            Math.round((verifiedSlot.getTime() - now2.getTime()) / 60000),
          );
          finalWaitCount = countQueueCustomersAhead(qIvsTx, verifiedSlot);
          console.log(
            "[queue create] slot adjusted inside tx",
            finalEstStart.toISOString(),
          );
        }
      }

      // Check which optional columns exist on QueueTickets
      const colCheck = await transaction.request().query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'QueueTickets'
          AND COLUMN_NAME IN ('EstimatedStartTime','EstimatedWaitMinutes','WaitingCountAtCreation','ExpectedStartAt','ExpectedEndAt','DurationMinutes','BranchID')
      `);
      const existingCols = new Set(
        colCheck.recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME),
      );

      const hasEst = existingCols.has("EstimatedStartTime");
      const hasWait = existingCols.has("EstimatedWaitMinutes");
      const hasWCount = existingCols.has("WaitingCountAtCreation");
      const hasExpStart = existingCols.has("ExpectedStartAt");
      const hasExpEnd = existingCols.has("ExpectedEndAt");
      const hasDurMin = existingCols.has("DurationMinutes");
      const hasBranchIdCol = existingCols.has("BranchID");

      const insertSql = `
        INSERT INTO [dbo].[QueueTickets]
          (TicketCode, TicketNumber, TicketPrefix, ClientID, EmpID, BookingID,
           QueueDate, CreatedTime, Status, Source, Priority, CreatedByUserID, Notes
           ${hasBranchIdCol ? ", BranchID" : ""}
           ${hasEst ? ", EstimatedStartTime" : ""}
           ${hasWait ? ", EstimatedWaitMinutes" : ""}
           ${hasWCount ? ", WaitingCountAtCreation" : ""}
           ${hasExpStart ? ", ExpectedStartAt" : ""}
           ${hasExpEnd ? ", ExpectedEndAt" : ""}
           ${hasDurMin ? ", DurationMinutes" : ""})
        OUTPUT INSERTED.QueueTicketID
        VALUES
          (@code, @num, @prefix, @clientId, @empId, @bookingId,
           @qDate, @cTime, 'waiting', @source, @priority, @userID, @notes
           ${hasBranchIdCol ? ", @branchId" : ""}
           ${hasEst ? ", @estStart" : ""}
           ${hasWait ? ", @estWait" : ""}
           ${hasWCount ? ", @waitCount" : ""}
           ${hasExpStart ? ", @expStart" : ""}
           ${hasExpEnd ? ", @expEnd" : ""}
           ${hasDurMin ? ", @durMin" : ""})
      `;

      const insReq = transaction
        .request()
        .input("code", sql.NVarChar, ticketCode)
        .input("num", sql.Int, ticketNumber)
        .input("prefix", sql.NVarChar, prefix)
        .input("clientId", sql.Int, clientId || null)
        .input("empId", sql.Int, empId || null)
        .input("bookingId", sql.Int, bookingId || null)
        .input("qDate", sql.Date, today)
        .input("cTime", sql.VarChar, createdTime)
        .input("source", sql.NVarChar, bookingId ? "booking" : "walk_in")
        .input("priority", sql.Int, priority)
        .input("userID", sql.Int, userID)
        .input("notes", sql.NVarChar, notes || null);

      if (hasBranchIdCol) insReq.input("branchId", sql.Int, branch.branchId);
      if (hasEst)
        insReq.input("estStart", sql.DateTime2, finalEstStart ?? null);
      if (hasWait) insReq.input("estWait", sql.Int, finalEstWait ?? null);
      if (hasWCount) insReq.input("waitCount", sql.Int, finalWaitCount ?? null);

      // Lifecycle columns
      const expectedEnd = finalEstStart
        ? new Date(finalEstStart.getTime() + customerDur * 60000)
        : null;
      if (hasExpStart)
        insReq.input("expStart", sql.DateTime2, finalEstStart ?? null);
      if (hasExpEnd)
        insReq.input("expEnd", sql.DateTime2, expectedEnd ?? null);
      if (hasDurMin)
        insReq.input("durMin", sql.Int, customerDur);

      const insertRes = await insReq.query(insertSql);
      newId = insertRes.recordset[0].QueueTicketID;
      await transaction.commit();

      console.log("[queue POST] inserted ticket", {
        queueTicketId: newId,
        ticketCode,
        ticketNumber,
        queueDate: today,
        createdTime,
        status: "waiting",
        clientId: clientId ?? null,
        empId: empId ?? null,
        estimatedStartTime: finalEstStart?.toISOString() ?? null,
        estimatedWaitMinutes: finalEstWait,
      });
    } catch (txErr) {
      console.error("[queue POST] transaction failed", txErr);
      await transaction.rollback();
      throw txErr;
    }

    // Write history (outside transaction — non-critical)
    await db
      .request()
      .input("ticketId", sql.Int, newId)
      .input("action", sql.NVarChar, "created")
      .input("userID", sql.Int, userID)
      .query(
        `
        INSERT INTO [dbo].[QueueTicketHistory]
          (QueueTicketID, OldStatus, NewStatus, ActionType, UserID)
        VALUES (@ticketId, NULL, 'waiting', @action, @userID)
      `,
      )
      .catch((e: unknown) =>
        console.error("[queue POST] history write failed", e),
      );

    // Save ticket services (non-critical — outside transaction)
    if (services.length > 0) {
      console.log(
        "[queue POST] saving services",
        services.map((s) => ({ proId: s.proId, proName: s.proName })),
      );
      const svcTableCheck = await db
        .request()
        .query(
          `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='QueueTicketServices'`,
        );
      if (svcTableCheck.recordset.length) {
        for (const svc of services) {
          await db
            .request()
            .input("ticketId", sql.Int, newId)
            .input("proId", sql.Int, svc.proId ?? null)
            .input("proName", sql.NVarChar, svc.proName ?? null)
            .input("qty", sql.Decimal(10, 2), svc.qty ?? 1)
            .input("dur", sql.Int, svc.durationMinutes ?? null)
            .input("price", sql.Decimal(10, 2), svc.price ?? null)
            .query(
              `
              INSERT INTO [dbo].[QueueTicketServices]
                (QueueTicketID, ProID, ProName, Qty, DurationMinutes, Price)
              VALUES (@ticketId, @proId, @proName, @qty, @dur, @price)
            `,
            )
            .catch((e: unknown) =>
              console.error("[queue POST] service insert failed", e),
            );
        }

        // Verify services were saved
        const svcCheck = await db
          .request()
          .input("tid", sql.Int, newId)
          .query(
            `
            SELECT qts.QueueTicketID, qts.ProID, qts.ProName, p.ProName AS CatalogName
            FROM [dbo].[QueueTicketServices] qts
            LEFT JOIN [dbo].[TblPro] p ON p.ProID = qts.ProID
            WHERE qts.QueueTicketID = @tid
          `,
          )
          .catch(() => ({ recordset: [] as any[] }));
        console.log(
          "[queue POST] db services after insert",
          svcCheck.recordset,
        );
      } else {
        console.warn(
          "[queue POST] QueueTicketServices table does not exist — services not saved",
        );
      }
    } else {
      console.log("[queue POST] no services to save");
    }

    // ── STEP 2: Re-fetch full ticket from DB ──────────────────────────────
    const fullTicketRes = await db
      .request()
      .input("newId", sql.Int, newId)
      .query(
        `
        SELECT
          qt.QueueTicketID, qt.TicketCode, qt.TicketNumber,
          qt.ClientID,      qt.EmpID,
          qt.QueueDate,     qt.CreatedTime,
          qt.Status,        qt.Notes,
          qt.EstimatedStartTime,
          qt.EstimatedWaitMinutes,
          qt.WaitingCountAtCreation,
          CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedStartAt') IS NOT NULL
               THEN qt.ExpectedStartAt ELSE NULL END AS ExpectedStartAt,
          CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedEndAt') IS NOT NULL
               THEN qt.ExpectedEndAt ELSE NULL END AS ExpectedEndAt,
          CASE WHEN COL_LENGTH('dbo.QueueTickets','DurationMinutes') IS NOT NULL
               THEN qt.DurationMinutes ELSE NULL END AS DurationMinutes,
          c.[Name]   AS ClientName,
          c.Mobile   AS ClientMobile,
          e.EmpName  AS EmpName
        FROM [dbo].[QueueTickets] qt
        LEFT JOIN [dbo].[TblClient] c ON c.ClientID = qt.ClientID
        LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = qt.EmpID
        WHERE qt.QueueTicketID = @newId
      `,
      )
      .catch((e: unknown) => {
        console.error("[queue POST] re-fetch failed", e);
        return { recordset: [] as any[] };
      });

    const fullTicket = fullTicketRes.recordset[0] ?? null;
    console.log("[queue POST] db ticket after insert", fullTicket);

    // ── STEP 5 diagnostic: show latest 5 tickets in DB ────────────────────
    const latestRes = await db
      .request()
      .query(
        `
      SELECT TOP 5
        qt.QueueTicketID, qt.TicketCode, qt.QueueDate, qt.Status,
        qt.ClientID, c.[Name] AS ClientName,
        qt.EmpID,    e.EmpName,
        qt.CreatedTime
      FROM [dbo].[QueueTickets] qt
      LEFT JOIN [dbo].[TblClient] c ON c.ClientID = qt.ClientID
      LEFT JOIN [dbo].[TblEmp]   e ON e.EmpID    = qt.EmpID
      ORDER BY qt.QueueTicketID DESC
    `,
      )
      .catch(() => ({ recordset: [] as any[] }));
    console.log("[queue POST] latest 5 DB tickets", latestRes.recordset);

    // ── Fetch saved services ───────────────────────────────────────────────
    let savedServices: Array<{
      ProID: number | null;
      ProName: string | null;
      Qty: number;
    }> = [];
    const svcFetchRes = await db
      .request()
      .input("tid", sql.Int, newId)
      .query(
        `
        SELECT qts.ProID, COALESCE(qts.ProName, p.ProName) AS ProName, qts.Qty
        FROM [dbo].[QueueTicketServices] qts
        LEFT JOIN [dbo].[TblPro] p ON p.ProID = qts.ProID
        WHERE qts.QueueTicketID = @tid
      `,
      )
      .catch(() => ({ recordset: [] as any[] }));
    savedServices = svcFetchRes.recordset;

    // ── Normalize createdTime — mssql returns SQL TIME as a Date (1970-01-01T...) ──
    function normalizeTimeField(v: unknown): string | null {
      if (!v) return null;
      if (typeof v === "string") {
        // Already a string like "21:30:00" — return as-is
        return v.slice(0, 8);
      }
      if (v instanceof Date) {
        // mssql driver wraps TIME in a Date with epoch date — extract HH:MM:SS from UTC
        const hh = String(v.getUTCHours()).padStart(2, "0");
        const mm = String(v.getUTCMinutes()).padStart(2, "0");
        const ss = String(v.getUTCSeconds()).padStart(2, "0");
        return `${hh}:${mm}:${ss}`;
      }
      return null;
    }

    // ── Build normalized response ──────────────────────────────────────────
    const servicesText = savedServices
      .map((s) => s.ProName ?? "")
      .filter(Boolean)
      .join(" + ");

    const responsePayload = {
      ok: true,
      ticketId: newId,
      ticketCode,
      ticket: fullTicket
        ? {
            queueTicketId: fullTicket.QueueTicketID,
            ticketCode: fullTicket.TicketCode,
            ticketNumber: fullTicket.TicketNumber,
            status: fullTicket.Status,
            clientId: fullTicket.ClientID,
            clientName: fullTicket.ClientName ?? null,
            clientPhone: fullTicket.ClientMobile ?? null,
            empId: fullTicket.EmpID,
            barberName: fullTicket.EmpName ?? null,
            services: savedServices,
            servicesText,
            queueDate: fullTicket.QueueDate,
            createdTime: normalizeTimeField(fullTicket.CreatedTime),
            estimatedStartTime: fullTicket.EstimatedStartTime ?? null,
            estimatedWaitMinutes: fullTicket.EstimatedWaitMinutes ?? null,
            waitingCountAtCreation: fullTicket.WaitingCountAtCreation ?? null,
            expectedStartAt: fullTicket.ExpectedStartAt ?? null,
            expectedEndAt: fullTicket.ExpectedEndAt ?? null,
            durationMinutes: fullTicket.DurationMinutes ?? null,
            notes: fullTicket.Notes ?? null,
          }
        : null,
      // Flat fields — use server-recalculated values (not the stale client-supplied ones)
      estimatedStartTime: finalEstStart?.toISOString() ?? null,
      estimatedWaitMinutes: finalEstWait ?? null,
      waitingCountAtCreation: finalWaitCount ?? null,
    };

    console.log("[queue POST] response payload", {
      ok: responsePayload.ok,
      ticketId: responsePayload.ticketId,
      ticketCode: responsePayload.ticketCode,
      ticket: responsePayload.ticket
        ? {
            clientName: responsePayload.ticket.clientName,
            barberName: responsePayload.ticket.barberName,
            servicesText: responsePayload.ticket.servicesText,
            queueDate: responsePayload.ticket.queueDate,
            status: responsePayload.ticket.status,
          }
        : null,
    });

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err) {
    console.error("[queue POST]", err);
    return NextResponse.json(
      { error: "فشل إنشاء رقم الانتظار" },
      { status: 500 },
    );
  }
}
