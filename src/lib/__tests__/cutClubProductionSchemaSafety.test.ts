import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ddl = readFileSync(resolve(process.cwd(),
  "docs/cut-club/sql/production-readonly-metadata.sql"), "utf8");

describe("CUT CLUB owner-authorized production metadata inspection contract", () => {
  it("has an explicit expected database operator guard (no default auto-connect)", () => {
    expect(ddl).toContain("__OPERATOR_VERIFY_DATABASE_NAME__");
    expect(ddl).toContain("DB_NAME() <> @ExpectedDb");
    expect(ddl).toContain("THROW 51980");
    expect(ddl).toContain("SET LOCK_TIMEOUT 3000");
  });

  it("is metadata-only; no SQL DML/DDL or table row reads", () => {
    const executable = ddl.replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--[^\n]*/g, "");
    expect(executable).toContain("FROM sys.tables");
    expect(executable).toContain("FROM sys.foreign_keys");
    expect(executable).toContain("FROM sys.indexes");
    for (const forbidden of [
      /\bUPDATE\s+dbo\./i, /\bDELETE\s+FROM\b/i,
      /\bINSERT\s+INTO\b/i, /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i, /\bTRUNCATE\s+TABLE\b/i,
      /\bEXEC(?:UTE)?\s+\w+/i,
      /\bFROM\s+(?:\[dbo\]\.|dbo\.)(?:TblClient|TblClientLoyalty|TblClientInventory)/i,
    ]) expect(executable).not.toMatch(forbidden);
  });
});
