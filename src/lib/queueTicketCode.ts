/**
 * queueTicketCode.ts — Ticket code generation utilities
 */

import { getPool } from "@/lib/db";

/**
 * Generate a ticket code for a specific date with a given prefix.
 * Format: {prefix}{sequenceNumber} (e.g., "W-001", "Q-005", "B-012")
 *
 * @param db - Database pool (must be within transaction if atomicity needed)
 * @param dateStr - Date string "YYYY-MM-DD"
 * @param prefix - Ticket prefix (e.g., "W" for walk-in, "Q" for queue, "B" for booking)
 * @param startNumber - Starting number (default 1)
 */
export async function generateTicketCode(
  db: Awaited<ReturnType<typeof getPool>>,
  dateStr: string,
  prefix: string,
  startNumber: number = 1
): Promise<string> {
  const numRes = await db
    .request()
    .input("qDate", (await import("@/lib/db")).sql.Date, dateStr)
    .query(`
      SELECT ISNULL(MAX(TicketNumber), ${startNumber - 1}) + 1 AS NextNum
      FROM [dbo].[QueueTickets]
      WHERE QueueDate = @qDate
    `);

  const ticketNumber = numRes.recordset[0].NextNum;
  return `${prefix}-${String(ticketNumber).padStart(3, "0")}`;
}

/**
 * Generate ticket code within a transaction with locking.
 * Use this when inserting a new ticket to ensure atomic number assignment.
 */
export async function generateTicketCodeInTransaction(
  request: any, // sql.Request within transaction
  dateStr: string,
  prefix: string,
  startNumber: number = 1
): Promise<{ ticketCode: string; ticketNumber: number }> {
  const { sql } = await import("@/lib/db");

  const numRes = await request
    .input("qDate", sql.Date, dateStr)
    .query(`
      SELECT ISNULL(MAX(TicketNumber), ${startNumber - 1}) + 1 AS NextNum
      FROM [dbo].[QueueTickets] WITH (UPDLOCK, HOLDLOCK)
      WHERE QueueDate = @qDate
    `);

  const ticketNumber = numRes.recordset[0].NextNum;
  const ticketCode = `${prefix}-${String(ticketNumber).padStart(3, "0")}`;

  return { ticketCode, ticketNumber };
}
