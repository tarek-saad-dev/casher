/**
 * Admin API: Create indexes for booking performance optimization
 *
 * GET: Check which indexes exist, report missing
 * POST: Create missing indexes only (idempotent)
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

// Auth check
function isAuthorized(req: NextRequest): boolean {
  const secretKey = req.headers.get("x-admin-secret");
  const adminKey = process.env.ADMIN_SECRET_KEY || "admin-secret-change-me";
  return secretKey === adminKey;
}

// Check if table exists
async function tableExists(
  db: sql.ConnectionPool,
  tableName: string,
): Promise<boolean> {
  const result = await db.request().query(`
    SELECT OBJECT_ID('dbo.${tableName}') as oid
  `);
  return result.recordset[0].oid !== null;
}

// Check if column exists
async function columnExists(
  db: sql.ConnectionPool,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${columnName}'
  `);
  return result.recordset[0].count > 0;
}

// Check if index exists
async function indexExists(
  db: sql.ConnectionPool,
  tableName: string,
  indexName: string,
): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) as count
    FROM sys.indexes
    WHERE name = '${indexName}'
      AND object_id = OBJECT_ID('dbo.${tableName}')
  `);
  return result.recordset[0].count > 0;
}

interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  includes?: string[];
  requiredTable: string;
  requiredColumns: string[];
}

// Define indexes needed for available-days performance
const INDEXES: IndexDefinition[] = [
  {
    name: "IX_QueueTickets_EmpID_QueueDate_Status",
    table: "QueueTickets",
    columns: ["EmpID", "QueueDate", "Status"],
    includes: ["ServiceStartedAt", "DurationMinutes", "TicketCode"],
    requiredTable: "QueueTickets",
    requiredColumns: ["EmpID", "QueueDate", "Status"],
  },
  {
    name: "IX_Bookings_AssignedEmpID_BookingDate_Status",
    table: "Bookings",
    columns: ["AssignedEmpID", "BookingDate", "Status"],
    includes: ["StartTime", "EndTime"],
    requiredTable: "Bookings",
    requiredColumns: ["AssignedEmpID", "BookingDate", "Status"],
  },
  {
    name: "IX_Bookings_EmpID_BookingDate_Status",
    table: "Bookings",
    columns: ["EmpID", "BookingDate", "Status"],
    includes: ["StartTime", "EndTime"],
    requiredTable: "Bookings",
    requiredColumns: ["EmpID", "BookingDate", "Status"],
  },
  {
    name: "IX_TblEmpWorkSchedule_EmpID_DayOfWeek",
    table: "TblEmpWorkSchedule",
    columns: ["EmpID", "DayOfWeek"],
    includes: ["IsWorkingDay", "StartTime", "EndTime"],
    requiredTable: "TblEmpWorkSchedule",
    requiredColumns: ["EmpID", "DayOfWeek"],
  },
  {
    name: "IX_TblEmpDayOff_EmpID_OffDate",
    table: "TblEmpDayOff",
    columns: ["EmpID", "OffDate"],
    requiredTable: "TblEmpDayOff",
    requiredColumns: ["EmpID", "OffDate"],
  },
];

// GET: Check current index status
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getPool();
    const results = {
      existing: [] as string[],
      missing: [] as string[],
      skipped: [] as { name: string; reason: string }[],
    };

    for (const idx of INDEXES) {
      // Check if required table exists
      const hasTable = await tableExists(db, idx.requiredTable);
      if (!hasTable) {
        results.skipped.push({
          name: idx.name,
          reason: `Table ${idx.requiredTable} does not exist`,
        });
        continue;
      }

      // Check if all required columns exist
      const missingColumns = [];
      for (const col of idx.requiredColumns) {
        const hasCol = await columnExists(db, idx.requiredTable, col);
        if (!hasCol) {
          missingColumns.push(col);
        }
      }
      if (missingColumns.length > 0) {
        results.skipped.push({
          name: idx.name,
          reason: `Missing columns: ${missingColumns.join(", ")}`,
        });
        continue;
      }

      // Check if index already exists
      const exists = await indexExists(db, idx.table, idx.name);
      if (exists) {
        results.existing.push(idx.name);
      } else {
        results.missing.push(idx.name);
      }
    }

    return NextResponse.json({
      ok: true,
      status: results,
      canMigrate: results.missing.length > 0,
    });
  } catch (err: any) {
    console.error("[booking-indexes-migrate] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 },
    );
  }
}

// POST: Create missing indexes
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getPool();
    const results = {
      created: [] as string[],
      skipped: [] as { name: string; reason: string }[],
      errors: [] as { name: string; error: string }[],
    };

    for (const idx of INDEXES) {
      try {
        // Check if required table exists
        const hasTable = await tableExists(db, idx.requiredTable);
        if (!hasTable) {
          results.skipped.push({
            name: idx.name,
            reason: `Table ${idx.requiredTable} does not exist`,
          });
          continue;
        }

        // Check if all required columns exist
        const missingColumns = [];
        for (const col of idx.requiredColumns) {
          const hasCol = await columnExists(db, idx.requiredTable, col);
          if (!hasCol) {
            missingColumns.push(col);
          }
        }
        if (missingColumns.length > 0) {
          results.skipped.push({
            name: idx.name,
            reason: `Missing columns: ${missingColumns.join(", ")}`,
          });
          continue;
        }

        // Check if index already exists
        const exists = await indexExists(db, idx.table, idx.name);
        if (exists) {
          results.skipped.push({
            name: idx.name,
            reason: "Index already exists",
          });
          continue;
        }

        // Build INCLUDE clause with only existing columns
        const includeCols: string[] = [];
        if (idx.includes) {
          for (const col of idx.includes) {
            const hasCol = await columnExists(db, idx.table, col);
            if (hasCol) {
              includeCols.push(col);
            }
          }
        }

        // Build and execute CREATE INDEX
        const columnList = idx.columns.join(", ");
        const includeClause =
          includeCols.length > 0
            ? `INCLUDE (${includeCols.join(", ")})`
            : "";

        const createSql = `
          CREATE NONCLUSTERED INDEX ${idx.name}
          ON dbo.${idx.table} (${columnList})
          ${includeClause}
        `;

        await db.request().query(createSql);
        results.created.push(idx.name);
      } catch (err: any) {
        console.error(`[booking-indexes-migrate] Error creating ${idx.name}:`, err);
        results.errors.push({ name: idx.name, error: err.message });
      }
    }

    return NextResponse.json({
      ok: true,
      results,
      success: results.created.length > 0,
    });
  } catch (err: any) {
    console.error("[booking-indexes-migrate] POST error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 },
    );
  }
}
