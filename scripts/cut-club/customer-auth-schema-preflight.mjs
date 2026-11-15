/**
 * CUT CLUB B2 staging metadata preflight (#257).
 *
 * No database client, credential read, HTTP call, DDL or migration execution.
 * --sql prints an explicitly staging-guarded SQL metadata-only query.
 * --check <file.json> evaluates operator-supplied metadata offline.
 * This can NEVER attest customer/tenant ownership or approve a real OTP login.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const STAGING_METADATA_SQL = `SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
  THROW 51001, 'CUT CLUB staging-only metadata preflight', 1;

SELECT DB_NAME() AS [database], SUSER_SNAME() AS [login],
  JSON_QUERY((
    SELECT s.name AS [schema], t.name AS [table], c.name AS [column],
           ty.name AS [type], c.is_nullable AS [nullable]
    FROM sys.tables AS t
    JOIN sys.schemas AS s ON s.schema_id = t.schema_id
    JOIN sys.columns AS c ON c.object_id = t.object_id
    JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
    WHERE s.name = N'dbo' AND t.name IN (
      N'Tenant', N'LegacyIdMap', N'TblClient', N'TblClientLoyalty',
      N'TblClientInventory', N'CustomerOtpChallenge',
      N'CustomerOtpRateLimit', N'CustomerSession'
    )
    ORDER BY t.name, c.column_id
    FOR JSON PATH
  )) AS [columns],
  JSON_QUERY((
    SELECT ps.name AS [schema], pt.name AS [table], fk.name AS [name],
           rs.name AS [targetSchema], rt.name AS [targetTable]
    FROM sys.foreign_keys AS fk
    JOIN sys.tables AS pt ON pt.object_id = fk.parent_object_id
    JOIN sys.schemas AS ps ON ps.schema_id = pt.schema_id
    JOIN sys.tables AS rt ON rt.object_id = fk.referenced_object_id
    JOIN sys.schemas AS rs ON rs.schema_id = rt.schema_id
    WHERE ps.name = N'dbo' AND pt.name IN (
      N'LegacyIdMap', N'TblClient', N'CustomerOtpChallenge', N'CustomerSession'
    )
    ORDER BY pt.name, fk.name
    FOR JSON PATH
  )) AS [foreignKeys]
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;`;

const expected = [
  ["Tenant", "TenantId", "uniqueidentifier"],
  ["LegacyIdMap", "TenantId", "uniqueidentifier"],
  ["LegacyIdMap", "EntityName", "nvarchar"],
  ["LegacyIdMap", "LegacyKey", "nvarchar"],
  ["LegacyIdMap", "DrvoId", "uniqueidentifier"],
  ["TblClient", "ClientID", "int"],
];

/**
 * Only verifies well-formed staging schema metadata, NOT membership identity.
 * All outputs are constant field names and counts; no customer values.
 */
export function evaluateStagingAuthMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      input.database !== "last132_agent" || input.login !== "drvo_agent" ||
      !Array.isArray(input.columns) || !Array.isArray(input.foreignKeys) ||
      input.columns.length > 10_000 || input.foreignKeys.length > 10_000) {
    return { metadataValid: false, missing: [], reason: "STAGING_IDENTITY_OR_SHAPE_INVALID", customerIdentityProven: false, readyToIssueOtp: false };
  }

  const all = input.columns;
  const structured = all.every(row =>
    row && typeof row === "object" &&
    typeof row.schema === "string" && typeof row.table === "string" &&
    typeof row.column === "string" && typeof row.type === "string");
  if (!structured) {
    return { metadataValid: false, missing: [], reason: "COLUMN_METADATA_INVALID", customerIdentityProven: false, readyToIssueOtp: false };
  }

  const missing = expected
    .filter(([table, column, type]) => !all.some(row =>
      row.schema === "dbo" && row.table === table &&
      row.column === column && row.type.toLowerCase() === type))
    .map(([table, column]) => `dbo.${table}.${column}`);

  const fkExists = input.foreignKeys.some(row =>
    row && row.schema === "dbo" && row.table === "LegacyIdMap" &&
    row.targetSchema === "dbo" && row.targetTable === "Tenant");
  if (!fkExists) missing.push("FK_LegacyIdMap_Tenant");

  const hasAuthTables = ["CustomerOtpChallenge", "CustomerOtpRateLimit", "CustomerSession"]
    .every(table => all.some(row => row.schema === "dbo" && row.table === table));

  return {
    metadataValid: missing.length === 0,
    missing,
    reason: missing.length ? "SCHEMA_FOUNDATION_INCOMPLETE" : "NEEDS_AUTHORITY_AND_PROVIDER_REVIEW",
    authTablesPresent: hasAuthTables,
    customerIdentityProven: false,
    readyToIssueOtp: false,
  };
}

export function runCli(argv, io = { write: console.log, error: console.error }) {
  if (argv.length === 1 && argv[0] === "--sql") {
    io.write(STAGING_METADATA_SQL);
    return 0;
  }
  if (argv.length === 2 && argv[0] === "--check" && typeof argv[1] === "string") {
    try {
      const raw = readFileSync(argv[1]);
      if (raw.byteLength > 262_144) throw Error("input-too-large");
      const report = evaluateStagingAuthMetadata(JSON.parse(raw.toString("utf8")));
      io.write(JSON.stringify(report, null, 2));
      return report.metadataValid ? 0 : 1;
    } catch {
      io.error("Invalid staging metadata fixture; no data printed.");
      return 1;
    }
  }
  io.error("Usage: node scripts/cut-club/customer-auth-schema-preflight.mjs --sql | --check metadata.json");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
