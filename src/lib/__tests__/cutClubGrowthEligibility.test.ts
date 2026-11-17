import { describe, expect, it } from "vitest";
import {
  decidePartnerBenefit, previewVisitChallenge, previewReferral,
} from "@/lib/cut-club/growthEligibility";

const now = 1_900_000_000;
const base = {
  tenantId: "cut-tenant-A",
  customerId: 101,
  branchId: 7,
  nowSeconds: now,
  affiliation: {
    id: "aff-01", tenantId: "cut-tenant-A", customerId: 101,
    partnerId: "univ-01", category: "university" as const,
    verification: "verified" as const, verifiedAt: now - 300,
    expiresAt: now + 1000,
  },
  policies: [{
    id: "campus-01", version: 2, tenantId: "cut-tenant-A",
    partnerId: "univ-01", category: "university" as const,
    enabled: true, startsAt: now - 900, endsAt: now + 900,
    allowedBranchIds: [7], benefitLabelAr: "مزايا الشراكة المعتمدة",
  }],
};

describe("CUT CLUB policy-as-data growth scalability (#298)", () => {
  it("evaluates explicitly verified, tenant/branch-scoped university benefits", () => {
    expect(decidePartnerBenefit(base)).toEqual({
      eligible: true, reason: "eligible", programVersion: 2,
      benefitLabelAr: "مزايا الشراكة المعتمدة",
    });
  });

  it("rejects inactive/mismatched/unverified/expired affiliations and branch rules", () => {
    const changed = [
      { affiliation: { ...base.affiliation, verification: "pending" } },
      { affiliation: { ...base.affiliation, customerId: 102 } },
      { affiliation: { ...base.affiliation, tenantId: "other-tenant" } },
      { affiliation: { ...base.affiliation, expiresAt: now } },
      { branchId: 8 },
      { tenantId: "other-tenant" },
      { nowSeconds: now + 2000 },
    ];
    for (const x of changed) expect(decidePartnerBenefit({ ...base, ...x }).eligible).toBe(false);
  });

  it("selects latest version, rejects conflicting rules and NEVER creates a financial entitlement", () => {
    const older = { ...base.policies[0], version: 1, benefitLabelAr: "Old benefit" };
    const newer = { ...base.policies[0], version: 3, benefitLabelAr: "New benefit" };
    expect(decidePartnerBenefit({ ...base, policies: [older, newer] })).toMatchObject({
      eligible: true, programVersion: 3, benefitLabelAr: "New benefit",
    });
    expect(decidePartnerBenefit({ ...base, policies: [newer, { ...newer, id: "duplicate-policy" }] }).eligible).toBe(false);
  });

  it("counts only unique, completed, eligible tenant/branch visit events", () => {
    const challenge = {
      id: "visits-01", tenantId: "cut-tenant-A", version: 1,
      startsAt: now - 1000, endsAt: now + 1000,
      targetVisits: 3, allowedBranchIds: [7],
    };
    const visit = {
      eventId: "sale-1", tenantId: "cut-tenant-A", customerId: 101,
      branchId: 7, completedAt: now - 100,
      qualifies: true, reversed: false,
    };
    expect(previewVisitChallenge({
      tenantId: "cut-tenant-A", customerId: 101, challenge,
      visits: [visit, visit, { ...visit, eventId: "sale-2" },
        { ...visit, eventId: "reversal", reversed: true },
        { ...visit, eventId: "different-branch", branchId: 9 }],
    })).toEqual({
      status: "in_progress", progress: 2, target: 3, awardAvailable: false,
    });
    expect(previewVisitChallenge({
      tenantId: "cut-tenant-A", customerId: 101, challenge,
      visits: [visit, { ...visit, eventId: "sale-2" }, { ...visit, eventId: "sale-3" }],
    })).toEqual({
      status: "target_reached", progress: 3, target: 3, awardAvailable: false,
    });
    expect(previewVisitChallenge({
      tenantId: "cut-tenant-A", customerId: 101, challenge,
      visits: [{ ...visit, tenantId: "other-tenant" }],
    }).status).toBe("unavailable");
  });

  it("referrals reject self-invitations and already settled events; never award Coins", () => {
    const baseReferral = {
      tenantId: "cut-tenant-A", referrerId: 101, referredCustomerId: 102,
      occurredAt: now - 500, eligibleFirstVisitAt: now - 100,
      ruleStartsAt: now - 900, ruleEndsAt: now + 900,
      eventAlreadySettled: false,
    };
    expect(previewReferral(baseReferral)).toEqual({
      qualified: true, status: "eligible", awardAvailable: false,
    });
    expect(previewReferral({ ...baseReferral, eventAlreadySettled: true }).qualified).toBe(false);
    expect(previewReferral({ ...baseReferral, referredCustomerId: 101 }).status).toBe("unavailable");
    expect(previewReferral({ ...baseReferral, eligibleFirstVisitAt: null }).qualified).toBe(false);
    expect(previewReferral({ ...baseReferral, eligibleFirstVisitAt: now - 600 }).qualified).toBe(false);
  });
});
