/** Lookup over a snapshot (production SQL or test fixture). */
import { emptyConciergeSnapshot, isConciergeTestHub } from './defaults';
import { fixtureSnapshot } from './knowledgeStore';
import { matchAgainstAliases, normalizeConciergeText } from './matching';
import type {
  CapabilityItem,
  ConciergeSnapshot,
  ExternalLinkItem,
  KnowledgeItem,
  OfferItem,
} from './types';

function resolveSnap(snapshot?: ConciergeSnapshot): ConciergeSnapshot {
  if (snapshot) return snapshot;
  return isConciergeTestHub() ? fixtureSnapshot() : emptyConciergeSnapshot();
}

function isCurrentlyValid(item: { validFrom: string | null; validTo: string | null }, now: Date): boolean {
  const t = now.getTime();
  if (item.validFrom && new Date(item.validFrom).getTime() > t) return false;
  if (item.validTo && new Date(item.validTo).getTime() < t) return false;
  return true;
}

export function findKnowledge(
  text: string,
  snapshot?: ConciergeSnapshot,
  opts?: { branchCode?: string | null; now?: Date },
): { item: KnowledgeItem | null; resolution: 'resolved' | 'ambiguous' | 'unknown' } {
  const now = opts?.now ?? new Date();
  const active = resolveSnap(snapshot).knowledge.filter(
    (k) => k.status === 'active' && isCurrentlyValid(k, now),
  );
  let best: KnowledgeItem | null = null;
  let bestScore = 0;
  let second = 0;
  for (const item of active) {
    if (
      opts?.branchCode &&
      item.branchCode &&
      item.branchCode !== opts.branchCode
    ) {
      continue;
    }
    const aliases = [...item.aliases, item.title, item.subject ?? '', item.key].filter(Boolean);
    const { resolution, score } = matchAgainstAliases(text, aliases);
    if (resolution === 'unknown') continue;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = item;
    } else if (score > second) {
      second = score;
    }
  }
  if (!best) return { item: null, resolution: 'unknown' };
  if (bestScore - second < 15 && second >= 55) {
    return { item: best, resolution: 'ambiguous' };
  }
  return { item: best, resolution: 'resolved' };
}

export function findCapability(
  text: string,
  snapshot?: ConciergeSnapshot,
  branchCode?: string | null,
): { item: CapabilityItem | null; resolution: 'resolved' | 'ambiguous' | 'unknown' } {
  const active = resolveSnap(snapshot).capabilities.filter((c) => c.status === 'active');
  let best: CapabilityItem | null = null;
  let bestScore = 0;
  for (const item of active) {
    const aliases = [...item.aliases, item.displayNameAr, item.key];
    const { resolution, score } = matchAgainstAliases(text, aliases);
    if (resolution === 'unknown') continue;
    if (branchCode && item.branchCodes.length && !item.branchCodes.includes(branchCode)) {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (!best) return { item: null, resolution: 'unknown' };
  return { item: best, resolution: bestScore >= 70 ? 'resolved' : 'ambiguous' };
}

export function findLink(
  text: string,
  snapshot?: ConciergeSnapshot,
  opts?: { branchCode?: string | null; preferType?: ExternalLinkItem['linkType'] },
): ExternalLinkItem | null {
  const active = resolveSnap(snapshot).links.filter((l) => l.status === 'active');
  const t = normalizeConciergeText(text);

  const byType = (type: ExternalLinkItem['linkType']) =>
    active.find(
      (l) =>
        l.linkType === type &&
        (!opts?.branchCode || !l.branchCode || l.branchCode === opts.branchCode),
    ) ?? null;

  if (/انستجرام|انستا|instagram/.test(t)) return byType('INSTAGRAM');
  if (/فيسبوك|facebook/.test(t)) return byType('FACEBOOK');
  if (/تيك|tiktok/.test(t)) return byType('TIKTOK');
  if (/واتساب|whatsapp/.test(t)) return byType('WHATSAPP');
  if (/لينك\s*الحجز|احجز\s*اونلاين|احجز\s*منين|ازاي\s*احجز|موقع\s*الحجز|booking/.test(t)) {
    return byType('BOOKING');
  }
  if (/موقع|website|ويب/.test(t)) return byType('WEBSITE');
  if (/لوكيشن|maps|خريط|عنوان|فين|ابعتلي\s*(جليم|كامب)/.test(t)) {
    const maps = active.filter(
      (l) => l.linkType === 'GOOGLE_MAPS' || l.linkType === 'BRANCH_LOCATION',
    );
    if (opts?.branchCode) {
      return maps.find((l) => l.branchCode === opts.branchCode) ?? null;
    }
    return maps.length === 1 ? maps[0]! : null;
  }
  if (opts?.preferType) return byType(opts.preferType);
  return null;
}

export function listActiveOffers(snapshot?: ConciergeSnapshot, now = new Date()): OfferItem[] {
  const t = now.getTime();
  return resolveSnap(snapshot).offers
    .filter((o) => {
      if (o.status !== 'active') return false;
      if (o.validFrom && new Date(o.validFrom).getTime() > t) return false;
      if (o.validTo && new Date(o.validTo).getTime() < t) return false;
      return true;
    })
    .sort((a, b) => a.priority - b.priority);
}
