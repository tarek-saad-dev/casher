import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CUT_CLUB_REQUIRED_COLUMNS,
  evaluateCashierSchema,
  expectedProductionDbIsConfigured,
} from "@/lib/cut-club/cashierProductionPreflight";

const allRows = Object.entries(CUT_CLUB_REQUIRED_COLUMNS).flatMap(([table, cols]) =>
  cols.map(column => ({ TableName: table, ColumnName: column })));

describe("CUT CLUB metadata-only Production compatibility gate", () => {
  it("fails closed on missing tables and fields, even if some tables match", () => {
    const none = evaluateCashierSchema([]);
    expect(none.schemaCompatible).toBe(false);
    expect(none.checks).toHaveLength(9);
    expect(none.checks.every(x => !x.found)).toBe(true);
    const missing = evaluateCashierSchema(allRows.filter(x =>
      !(x.TableName === "TblInventoryUsageLog" && x.ColumnName === "BookingID")));
    expect(missing.schemaCompatible).toBe(false);
    expect(missing.checks.find(x => x.table === "TblInventoryUsageLog")?.missingColumns)
      .toEqual(["BookingID"]);
  });

  it("reports exactly the expected schema, but NEVER claims production launch ready", () => {
    const report = evaluateCashierSchema(allRows);
    expect(report.schemaCompatible).toBe(true);
    expect(report.checks.every(x => x.found && x.missingColumns.length === 0)).toBe(true);
    expect(report.readyForClientRelease).toBe(false);
    expect(report.readyForCashierRedemption).toBe(false);
    expect(report.verifiedAccountLinkage).toBe(false);
    expect(report.verifiedFinancialSettlement).toBe(false);
    expect(report.verifiedBranchSalonLinkage).toBe(false);
  });

  it("ignores extra/unrecognized schema and handles case-insensitive column names", () => {
    const rows = allRows.map(x => ({ ...x, ColumnName: x.ColumnName.toLowerCase() }));
    rows.push({ TableName: "Other", ColumnName: "ClientPhone" });
    expect(evaluateCashierSchema(rows).schemaCompatible).toBe(true);
    expect(JSON.stringify(evaluateCashierSchema(rows))).not.toContain("ClientPhone");
  });

  it("requires explicit expected DB from operator, no fallback or default", () => {
    expect(expectedProductionDbIsConfigured("Verified_DB_001")).toBe(true);
    for (const bad of [undefined, "", "a", "DB;DROP", "DB name", "__OPERATOR_VERIFY_DATABASE_NAME__", "a".repeat(129)]) {
      expect(expectedProductionDbIsConfigured(bad)).toBe(false);
    }
  });

  it("route demands admin+flag and metadata SQL contains no actual private data read/write", () => {
    const read = readFileSync(resolve(process.cwd(),
      "src/lib/cut-club/cashierProductionPreflight.ts"), "utf8");
    const route = readFileSync(resolve(process.cwd(),
      "src/app/api/admin/cut-club/readiness/route.ts"), "utf8");
    expect(route).toContain("requireAdmin()");
    expect(route).toContain("CUT_CLUB_PRODUCTION_METADATA_READ_ENABLED");
    expect(route).toContain("CUT_CLUB_METADATA_EXPECTED_DB");
    expect(route).toContain("no-store");
    expect(read).toContain("DB_NAME() <> @expectedDb");
    expect(read).toContain("FROM sys.tables");
    expect(read).toContain("INNER JOIN sys.columns");
    const query = read.slice(read.indexOf(".query<MetaRow>("));
    for (const forbidden of [
      /\bFROM\s+(?:dbo\.|\[dbo\]\.)TblClient\b/i,
      /\bFROM\s+(?:dbo\.|\[dbo\]\.)TblClientInventory\b/i,
      /\bUPDATE\s+(?:dbo\.|\[dbo\]\.)/i,
      /\bDELETE\s+FROM\s+(?:dbo\.|\[dbo\]\.)/i,
      /\bINSERT\s+INTO\s+(?:dbo\.|\[dbo\]\.)/i,
      /\bEXEC(?:UTE)?\b/i,
    ]) expect(query).not.toMatch(forbidden);
  });
});
