/**
 * CUT CLUB 2.0 — tenant-scoped, versioned membership/challenge/referral rule
 * evaluations (#298). These are READ-ONLY business decisions, not a Coins
 * awarder or voucher minting service. Server-side transaction + event
 * idempotency is mandatory before materializing any financial entitlement.
 */
export type PartnerCategory = "university" | "school" | "medical" | "company";
export type PartnerAffiliation = Readonly<{
  id: string;
  tenantId: string;
  customerId: number;
  partnerId: string;
  category: PartnerCategory;
  verification: "verified" | "pending" | "rejected" | "revoked";
  verifiedAt: number | null;
  expiresAt: number | null;
}>;

export type PartnerProgramPolicy = Readonly<{
  id: string;
  version: number;
  tenantId: string;
  partnerId: string;
  category: PartnerCategory;
  enabled: boolean;
  startsAt: number;
  endsAt: number | null;
  allowedBranchIds: readonly number[];
  /** Free text policy label; financial offers are NOT activated here. */
  benefitLabelAr: string;
}>;

export type PartnerDecision = Readonly<{
  eligible: boolean;
  reason: "eligible" | "not_verified" | "unavailable" | "expired" | "wrong_tenant" | "wrong_branch" | "outside_window" | "wrong_partner";
  programVersion: number | null;
  benefitLabelAr: string | null;
}>;

const goodId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const goodTs = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const goodString = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
const deny = (reason: PartnerDecision["reason"]): PartnerDecision => ({
  eligible: false, reason, programVersion: null, benefitLabelAr: null,
});

/** Select exactly one highest version of active partner rules for a tenant. */
export function decidePartnerBenefit(input: Readonly<{
  tenantId: string;
  customerId: number;
  branchId: number;
  nowSeconds: number;
  affiliation: PartnerAffiliation | null;
  policies: readonly PartnerProgramPolicy[];
}>): PartnerDecision {
  if (!goodString(input.tenantId) || !goodId(input.customerId) ||
      !goodId(input.branchId) || !goodTs(input.nowSeconds) ||
      !Array.isArray(input.policies) || input.policies.length > 100) return deny("unavailable");
  const a = input.affiliation;
  if (!a) return deny("not_verified");
  if (a.tenantId !== input.tenantId || a.customerId !== input.customerId) return deny("wrong_tenant");
  if (a.verification !== "verified" || !goodTs(a.verifiedAt) || a.verifiedAt > input.nowSeconds) return deny("not_verified");
  if (a.expiresAt !== null && (!goodTs(a.expiresAt) || a.expiresAt <= input.nowSeconds)) return deny("expired");
  const relevant = input.policies.filter(x => x.tenantId === input.tenantId &&
    x.partnerId === a.partnerId && x.category === a.category && x.enabled);
  if (relevant.length === 0) return deny("wrong_partner");
  if (relevant.some(x => !goodId(x.version) || !goodTs(x.startsAt) ||
      (x.endsAt !== null && (!goodTs(x.endsAt) || x.endsAt <= x.startsAt)) ||
      !Array.isArray(x.allowedBranchIds) || x.allowedBranchIds.some(b => !goodId(b)) ||
      typeof x.benefitLabelAr !== "string" || x.benefitLabelAr.length > 180)) return deny("unavailable");
  // If two rules share the same version, deployment has conflicting policy;
  // fail closed rather than granting both or silently choosing one.
  const newest = relevant.reduce((max, x) => Math.max(max, x.version), 0);
  const selected = relevant.filter(x => x.version === newest);
  if (selected.length !== 1) return deny("unavailable");
  const p = selected[0];
  if (input.nowSeconds < p.startsAt || (p.endsAt !== null && input.nowSeconds >= p.endsAt))
    return deny("outside_window");
  if (p.allowedBranchIds.length > 0 && !p.allowedBranchIds.includes(input.branchId))
    return deny("wrong_branch");
  return { eligible: true, reason: "eligible", programVersion: p.version,
    benefitLabelAr: p.benefitLabelAr };
}

export type QualifiedVisit = Readonly<{
  eventId: string;
  tenantId: string;
  customerId: number;
  branchId: number;
  completedAt: number;
  qualifies: boolean;
  reversed: boolean;
}>;
export type VisitChallenge = Readonly<{
  id: string; tenantId: string; version: number;
  startsAt: number; endsAt: number;
  targetVisits: number;
  allowedBranchIds: readonly number[];
}>;

export type ChallengePreview = Readonly<{
  status: "unavailable" | "in_progress" | "target_reached";
  progress: number;
  target: number;
  /** Explicitly no award: requires settlement/outbox/idempotency. */
  awardAvailable: false;
}>;

/** Counts DISTINCT completed visit events only; never writes Coins. */
export function previewVisitChallenge(input: Readonly<{
  tenantId: string; customerId: number; challenge: VisitChallenge;
  visits: readonly QualifiedVisit[];
}>): ChallengePreview {
  const closed = (): ChallengePreview => ({ status: "unavailable", progress: 0, target: 0, awardAvailable: false });
  const c = input.challenge;
  if (!goodString(input.tenantId) || !goodId(input.customerId) || !c ||
      c.tenantId !== input.tenantId || !goodId(c.version) || !goodTs(c.startsAt) ||
      !goodTs(c.endsAt) || c.endsAt <= c.startsAt || !goodId(c.targetVisits) ||
      c.targetVisits > 100 || !Array.isArray(c.allowedBranchIds) ||
      c.allowedBranchIds.some(x => !goodId(x)) ||
      !Array.isArray(input.visits) || input.visits.length > 10_000) return closed();

  const keys = new Set<string>();
  for (const visit of input.visits) {
    if (!visit || visit.tenantId !== input.tenantId ||
        visit.customerId !== input.customerId || !goodString(visit.eventId) ||
        !goodId(visit.branchId) || !goodTs(visit.completedAt)) return closed();
    if (visit.completedAt < c.startsAt || visit.completedAt >= c.endsAt ||
        visit.qualifies !== true || visit.reversed === true ||
        (c.allowedBranchIds.length > 0 && !c.allowedBranchIds.includes(visit.branchId))) continue;
    keys.add(visit.eventId);
  }
  const progress = Math.min(keys.size, c.targetVisits);
  return {
    status: progress >= c.targetVisits ? "target_reached" : "in_progress",
    progress, target: c.targetVisits, awardAvailable: false,
  };
}

export type ReferralPreview = Readonly<{
  qualified: boolean;
  status: "unavailable" | "pending" | "eligible";
  awardAvailable: false;
}>;
/** Never reveal referred phone, award Coins, or claim paid referral credit. */
export function previewReferral(input: Readonly<{
  tenantId: string; referrerId: number; referredCustomerId: number;
  occurredAt: number; eligibleFirstVisitAt: number | null;
  ruleStartsAt: number; ruleEndsAt: number;
  eventAlreadySettled: boolean;
}>): ReferralPreview {
  const unavailable = (): ReferralPreview => ({ qualified: false, status: "unavailable", awardAvailable: false });
  if (!goodString(input.tenantId) || !goodId(input.referrerId) ||
      !goodId(input.referredCustomerId) || input.referrerId === input.referredCustomerId ||
      !goodTs(input.occurredAt) || !goodTs(input.ruleStartsAt) ||
      !goodTs(input.ruleEndsAt) || input.ruleEndsAt <= input.ruleStartsAt ||
      typeof input.eventAlreadySettled !== "boolean") return unavailable();
  if (input.eventAlreadySettled || input.eligibleFirstVisitAt === null ||
      !goodTs(input.eligibleFirstVisitAt) ||
      input.eligibleFirstVisitAt < input.occurredAt ||
      input.eligibleFirstVisitAt < input.ruleStartsAt ||
      input.eligibleFirstVisitAt >= input.ruleEndsAt)
    return { qualified: false, status: "pending", awardAvailable: false };
  return { qualified: true, status: "eligible", awardAvailable: false };
}
