/** Pure campaign domain. Inputs must come from trusted, tenant-scoped POS reads, never public form claims. */
export type DecemberRates = Readonly<{
  firstVisit: number; student: number; club: number; multiService: number;
  friends: readonly [number, number, number];
}>;
export type DecemberFacts = Readonly<{
  active: boolean; registered: boolean; alreadyRedeemed: boolean; firstVisit: boolean;
  studentVerified: boolean; clubActive: boolean; eligiblePaidServiceIds: readonly string[];
  clientId: string;
  referrals: readonly { clientId: string; firstVisitCompleted: boolean; voided: boolean }[];
}>;
export type RuleCode = "FIRST_VISIT" | "STUDENT" | "CUT_CLUB" | "MULTI_SERVICE" | "REFERRAL";
export function validateRates(rates: DecemberRates) {
  const values = [rates.firstVisit, rates.student, rates.club, rates.multiService, ...rates.friends];
  if (rates.friends.length !== 3 || values.some(v => !Number.isInteger(v) || v < 0 || v > 100)
    || rates.friends[0] > rates.friends[1] || rates.friends[1] > rates.friends[2]) {
    throw new Error("INVALID_CAMPAIGN_RATES");
  }
}
export function evaluateDecember(facts: DecemberFacts, rates: DecemberRates, eligibleSubtotalPiasters: number) {
  validateRates(rates);
  if (!Number.isSafeInteger(eligibleSubtotalPiasters) || eligibleSubtotalPiasters < 0
    || eligibleSubtotalPiasters > Math.floor(Number.MAX_SAFE_INTEGER / 100)) throw new Error("INVALID_SUBTOTAL");
  const reason = !facts.active ? "INACTIVE" : !facts.registered ? "REGISTRATION_REQUIRED" :
    facts.alreadyRedeemed ? "ALREADY_REDEEMED" : null;
  const qualifyingFriends = new Set(facts.referrals.filter(r => r.clientId && r.clientId !== facts.clientId
    && r.firstVisitCompleted && !r.voided).map(r => r.clientId)).size;
  const rules: { code: RuleCode; percent: number }[] = [];
  if (!reason) {
    if (facts.firstVisit) rules.push({code:"FIRST_VISIT", percent:rates.firstVisit});
    if (facts.studentVerified) rules.push({code:"STUDENT", percent:rates.student});
    if (facts.clubActive) rules.push({code:"CUT_CLUB", percent:rates.club});
    if (new Set(facts.eligiblePaidServiceIds.filter(Boolean)).size >= 2)
      rules.push({code:"MULTI_SERVICE", percent:rates.multiService});
    if (qualifyingFriends) rules.push({code:"REFERRAL", percent:rates.friends[Math.min(qualifyingFriends, 3)-1]});
  }
  const rawPercent = rules.reduce((sum, rule) => sum + rule.percent, 0);
  const percent = Math.min(rawPercent, 100);
  const discountPiasters = Math.round(eligibleSubtotalPiasters * percent / 100);
  return {reason, rules, qualifyingFriends, rawPercent, percent, discountPiasters,
    payablePiasters: eligibleSubtotalPiasters - discountPiasters};
}
