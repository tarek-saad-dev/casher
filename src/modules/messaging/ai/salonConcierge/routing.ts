/** Concierge intent routing — live vs curated. */
import type { ConciergeBranchCode } from './branchBusinessHours';
import { normalizeConciergeText } from './matching';
import type { ConciergeIntent } from './types';

export function detectConciergeIntent(text: string): ConciergeIntent {
  const t = normalizeConciergeText(text);
  if (!t) return 'NONE';

  if (/فاتح|مفتوح|هتلحق|لسه فاتحين|فاتحين/.test(t)) return 'OPEN_NOW';

  if (
    /لوكيشن|الموقع على الخريطه|جوجل ماب|google\s*maps|ابعت.*(لوكيشن|الموقع)|فين\s*(جليم|كامب)/.test(
      t,
    ) ||
    /عنوان/.test(t) ||
    /ابعت\s*(ال)?لوكيشن/.test(t) ||
    /ابعتلي\s*(جليم|كامب)/.test(t) ||
    /^فين\s+/.test(t)
  ) {
    return 'DIRECTIONS_MAPS';
  }

  if (
    /انستجرام|انستا|instagram|فيسبوك|facebook|تيك\s*توك|tiktok|لينك\s*الحجز|موقعكم|الويب\s*سايت|website/.test(
      t,
    )
  ) {
    return 'EXTERNAL_LINK';
  }

  if (/عرض|عروض|برومو|خصم|بروموشن/.test(t)) return 'OFFER_QUERY';

  if (
    /شاطر|متخصص|خبره|ينفع\s*يعمل|حد\s*(يعمل|يعمل)|كيرلي|فيد|تدريج|صبغ|لون|يدفر|دفر|يعملها/.test(t) &&
    /(مين|حد|عندكم|عندكو|شاطر|متخصص)/.test(t)
  ) {
    return 'CAPABILITY_QUERY';
  }

  if (
    /عايز\s*(لون|صبغ|رمادي)|شعري|ينفع\s*ا|محتاج\s*(لون|صبغ)|مش عارف انهي|شبه كذا|محتاج اشوف|التقييم|استشاره/.test(
      t,
    )
  ) {
    return 'CONSULTATIVE';
  }

  if (/بكام|السعر|كام\s*سعر/.test(t)) return 'SERVICE_PRICE_LIVE';

  if (/مين\s*(متاح|موجود)|متاح\s*(دلوقتي|حاليا)/.test(t)) return 'AVAILABILITY_LIVE';

  if (
    /ساعات\s*العمل|بتفتحو|بتقفل|مواعيد|بيفتح\s*(امتي|امتى|ايمته)|امتي\s*تفتح|امتى\s*تفتح|امتى\s*بتفتح/.test(
      t,
    )
  ) {
    return 'HOURS_LIVE';
  }

  if (
    /احجز\s*ازاي|ازاي\s*احجز|الحجز\s*منين|جراج|موقف|باركينج|faq/.test(t) ||
    /بتقدموا|بتقدم|عندكم\s+\S+/.test(t)
  ) {
    return 'FAQ_KNOWLEDGE';
  }

  return 'NONE';
}

export function extractBranchHint(text: string): ConciergeBranchCode | null {
  const t = normalizeConciergeText(text);
  if (/جليم|gleem/.test(t)) return 'GLEEM';
  if (/كامب|شيزار|camp/.test(t)) return 'CAMP_CAESAR';
  return null;
}

export type { ConciergeBranchCode } from './branchBusinessHours';

const OPEN_NOW_FOLLOWUP_RE =
  /فاتحين|فاتح دلوقتي|مقفلين حاليًا|الفرعين فاتحين|لحد \d بعد منتصف الليل/;

/** Session-aware intent: branch follow-up after open-now stays OPEN_NOW. */
export function resolveConciergeIntent(
  text: string,
  session?: { recentTurns: Array<{ role: string; text?: string }> },
): ConciergeIntent {
  const base = detectConciergeIntent(text);
  if (base !== 'NONE') return base;
  if (!session?.recentTurns?.length) return 'NONE';

  const t = normalizeConciergeText(text);
  const branchOnly =
    ((/^طب\s/.test(t) || /^و(كامب|جليم)/.test(t)) && extractBranchHint(text) != null) ||
    (/^(جليم|كامب)\s*\?*$/.test(t) && extractBranchHint(text) != null);

  if (!branchOnly) return 'NONE';

  const lastBot = [...session.recentTurns].reverse().find((r) => r.role === 'bot');
  if (lastBot?.text && OPEN_NOW_FOLLOWUP_RE.test(lastBot.text)) {
    return 'OPEN_NOW';
  }
  return 'NONE';
}
