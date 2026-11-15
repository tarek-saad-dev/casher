import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStagingAuthMetadata, STAGING_METADATA_SQL, runCli } from "./customer-auth-schema-preflight.mjs";

const column = (table, name, type) => ({
  schema: "dbo", table, column: name, type, nullable: 0,
});
const complete = () => ({
  database: "last132_agent", login: "drvo_agent",
  columns: [
    column("Tenant", "TenantId", "uniqueidentifier"),
    column("LegacyIdMap", "TenantId", "uniqueidentifier"),
    column("LegacyIdMap", "EntityName", "nvarchar"),
    column("LegacyIdMap", "LegacyKey", "nvarchar"),
    column("LegacyIdMap", "DrvoId", "uniqueidentifier"),
    column("TblClient", "ClientID", "int"),
    column("CustomerOtpChallenge", "ChallengeId", "uniqueidentifier"),
    column("CustomerOtpRateLimit", "Scope", "nvarchar"),
    column("CustomerSession", "TokenDigest", "varbinary"),
  ],
  foreignKeys: [
    { schema: "dbo", table: "LegacyIdMap", name: "FK_LegacyIdMap_Tenant", targetSchema: "dbo", targetTable: "Tenant" },
  ],
});

test("emits SQL that fails closed outside dedicated staging database and login", () => {
  assert.match(STAGING_METADATA_SQL, /DB_NAME\(\) <> N'last132_agent'/);
  assert.match(STAGING_METADATA_SQL, /SUSER_SNAME\(\) <> N'drvo_agent'/);
  assert.match(STAGING_METADATA_SQL, /THROW 51001/);
  assert.match(STAGING_METADATA_SQL, /sys\.tables/);
  assert.match(STAGING_METADATA_SQL, /sys\.foreign_keys/);
  assert.doesNotMatch(STAGING_METADATA_SQL, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE TABLE|DROP TABLE|ALTER TABLE)\b/i);
  assert.doesNotMatch(STAGING_METADATA_SQL, /\bSELECT\s+\*\s+FROM\s+dbo\./i);
});

test("recognizes expected staging schema but NEVER grants OTP/login readiness", () => {
  const r = evaluateStagingAuthMetadata(complete());
  assert.equal(r.metadataValid, true);
  assert.equal(r.authTablesPresent, true);
  assert.equal(r.customerIdentityProven, false);
  assert.equal(r.readyToIssueOtp, false);
  assert.equal(r.reason, "NEEDS_AUTHORITY_AND_PROVIDER_REVIEW");
});

test("fails closed on production database or privileged/incorrect login", () => {
  for (const change of [
    { database: "last132" },
    { database: "last132_agent_copy" },
    { login: "sa" }, { login: null },
    { columns: [] }, { foreignKeys: [] },
  ]) {
    const r = evaluateStagingAuthMetadata({ ...complete(), ...change });
    assert.equal(r.readyToIssueOtp, false);
    assert.equal(r.metadataValid, false);
  }
});

test("detects tenant mapping mismatches and absent customer tables", () => {
  const r = evaluateStagingAuthMetadata({
    ...complete(),
    columns: complete().columns.filter(c => !(c.table === "LegacyIdMap" && c.column === "DrvoId")),
  });
  assert.equal(r.metadataValid, false);
  assert.ok(r.missing.includes("dbo.LegacyIdMap.DrvoId"));
  const wrongForeignKey = evaluateStagingAuthMetadata({
    ...complete(),
    foreignKeys: [{ schema: "dbo", table: "LegacyIdMap", targetSchema: "dbo", targetTable: "TblClient" }],
  });
  assert.equal(wrongForeignKey.metadataValid, false);
  assert.ok(wrongForeignKey.missing.includes("FK_LegacyIdMap_Tenant"));
});

test("malformed/incomplete metadata is rejected without echoing input", () => {
  for (const input of [null, [], {}, { ...complete(), columns: [{ phone: "sensitive" }] }]) {
    const r = evaluateStagingAuthMetadata(input);
    assert.equal(r.readyToIssueOtp, false);
    assert.equal(r.metadataValid, false);
    assert.doesNotMatch(JSON.stringify(r), /sensitive/);
  }
});

test("CLI never performs schema I/O by default and SQL output has no credentials", () => {
  const messages = [], errors = [];
  const io = { write: x => messages.push(x), error: x => errors.push(x) };
  assert.equal(runCli([], io), 2);
  assert.equal(runCli(["--sql"], io), 0);
  assert.ok(messages[0].includes("sys.columns"));
  assert.equal(runCli(["--check", "/not/a/real/fixture.json"], io), 1);
  assert.ok(errors.some(x => /Invalid staging metadata fixture/.test(x)));
});
