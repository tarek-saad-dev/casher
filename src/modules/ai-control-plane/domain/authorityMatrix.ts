import type { AuthorityClass, Domain } from './enums';

/** Code-owned authority precedence per domain (higher index = wins in conflicts). */
const DOMAIN_AUTHORITY_ORDER: Record<Domain, AuthorityClass[]> = {
  GENERAL: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'LIVE_ERP', 'LIVE_TRANSACTIONAL', 'SYSTEM_INVARIANT'],
  BRANCHES: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'LIVE_ERP', 'SYSTEM_INVARIANT'],
  OPENING_HOURS: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'LIVE_ERP', 'SYSTEM_INVARIANT'],
  PRICES: ['GENERAL_MODEL', 'OWNER_CURATED', 'REVIEWED_IMPORTED', 'LIVE_ERP', 'LIVE_TRANSACTIONAL', 'SYSTEM_INVARIANT'],
  SERVICES: ['GENERAL_MODEL', 'OWNER_CURATED', 'REVIEWED_IMPORTED', 'LIVE_ERP', 'SYSTEM_INVARIANT'],
  EMPLOYEES: ['GENERAL_MODEL', 'OWNER_CURATED', 'REVIEWED_IMPORTED', 'LIVE_ERP', 'LIVE_TRANSACTIONAL', 'SYSTEM_INVARIANT'],
  BOOKING: ['GENERAL_MODEL', 'OWNER_CURATED', 'REVIEWED_IMPORTED', 'LIVE_TRANSACTIONAL', 'SYSTEM_INVARIANT'],
  BOOKING_MANAGEMENT: ['GENERAL_MODEL', 'OWNER_CURATED', 'REVIEWED_IMPORTED', 'LIVE_TRANSACTIONAL', 'SYSTEM_INVARIANT'],
  HUMAN_HANDOFF: ['GENERAL_MODEL', 'OWNER_CURATED', 'SYSTEM_INVARIANT'],
  OFFERS: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'LIVE_ERP', 'SYSTEM_INVARIANT'],
  RECOMMENDATIONS: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'SYSTEM_INVARIANT'],
  COMPLAINTS: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'SYSTEM_INVARIANT'],
  BRAND_VOICE: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'SYSTEM_INVARIANT'],
  ESCALATION: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'SYSTEM_INVARIANT'],
  CUSTOMER_SERVICE: ['GENERAL_MODEL', 'REVIEWED_IMPORTED', 'OWNER_CURATED', 'SYSTEM_INVARIANT'],
};

export function defaultAuthorityForDomain(domain: Domain): AuthorityClass {
  switch (domain) {
    case 'PRICES':
    case 'SERVICES':
      return 'LIVE_ERP';
    case 'BOOKING':
    case 'BOOKING_MANAGEMENT':
      return 'LIVE_TRANSACTIONAL';
    default:
      return 'OWNER_CURATED';
  }
}

export function authorityRank(domain: Domain, authority: AuthorityClass): number {
  const order = DOMAIN_AUTHORITY_ORDER[domain];
  const idx = order.indexOf(authority);
  return idx >= 0 ? idx : -1;
}

export function canLearnedAuthorityCompete(domain: Domain, authority: AuthorityClass): boolean {
  const dominant = dominantAuthority(domain);
  return authorityRank(domain, authority) >= authorityRank(domain, dominant);
}

export function dominantAuthority(domain: Domain): AuthorityClass {
  const order = DOMAIN_AUTHORITY_ORDER[domain];
  return order[order.length - 1] ?? 'SYSTEM_INVARIANT';
}

export function isLowerAuthorityConflict(
  domain: Domain,
  proposed: AuthorityClass,
  existing: AuthorityClass,
): boolean {
  return authorityRank(domain, proposed) < authorityRank(domain, existing);
}

export function getAuthorityExplanationAr(domain: Domain): string {
  switch (domain) {
    case 'PRICES':
      return 'سعر الخدمة بيتحدد من بيانات الخدمات الحالية، فالمعلومة دي مش هتستبدل السعر المباشر.';
    case 'BOOKING':
    case 'BOOKING_MANAGEMENT':
      return 'حالة الحجز بتحدد من سجل الحجوزات الفعلي، ومش ممكن تتغير بتعليمات نصية.';
    case 'HUMAN_HANDOFF':
      return 'التحكم في المحادثة للموظف لا يمكن تجاوزه بتعليمات البوت.';
    default:
      return 'المصدر الحالي له أولوية أعلى على التعليمات المتعلمة.';
  }
}
