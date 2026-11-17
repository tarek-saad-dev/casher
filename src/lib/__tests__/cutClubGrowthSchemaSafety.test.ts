import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = readFileSync(resolve(process.cwd(),
  "docs/cut-club/sql/growth-core-staging.sql"), "utf8");

describe("CUT CLUB 2.0 growth persistence staging-only foundation", () => {
  it("refuses Production database / caller before any migration", () => {
    expect(schema).toContain("DB_NAME() <> N'last132_agent'");
    expect(schema).toContain("SUSER_SNAME() <> N'drvo_agent'");
    expect(schema).toContain("THROW 51970");
  });

  it("keeps organization, customer, branch, policy and events tenant-scoped", () => {
    for (const name of [
      "ClubOrganization", "ClubMemberAffiliation", "ClubPolicyVersion",
      "ClubEventInbox", "ClubGrowthSettlement", "ClubOutbox",
    ]) expect(schema).toContain("CREATE TABLE dbo." + name);
    expect(schema).toContain("PRIMARY KEY (TenantId, EventKey)");
    expect(schema).toContain("PRIMARY KEY (TenantId, CustomerId, IdempotencyKey)");
    expect(schema).toContain("PRIMARY KEY (TenantId, PolicyCode, Version)");
    expect(schema).toContain("UNIQUE (TenantId, CustomerId, OrganizationId)");
    expect(schema).toContain("UNIQUE (TenantId, IdempotencyKey)");
    expect(schema).toContain("FOREIGN KEY (TenantId, OrganizationId)");
    expect(schema).toContain("FOREIGN KEY (TenantId, SourceEventKey)");
    expect(schema).toContain("BranchLegacyId");
  });

  it("allows only explicit verified partnerships and durable event-driven accounting", () => {
    for (const label of ["school", "university", "medical", "company",
                         "verified", "pending", "revoked",
                         "visit_completed", "visit_reversed", "referral_qualifying",
                         "in_salon_gift", "committed", "reversed"]) {
      expect(schema).toContain(label);
    }
    expect(schema).toContain("ISJSON(SafePayloadJson)");
    expect(schema).toContain("SourceEventKey");
    expect(schema).not.toMatch(/\bUSE\s+(?:master|last132)\b/i);
  });
});
