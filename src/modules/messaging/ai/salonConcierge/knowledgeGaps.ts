/** Knowledge gap capture — aggregated subjects only. */
import { isConciergeTestHub } from './defaults';
import { normalizeConciergeText } from './matching';
import { getConciergeStore } from './knowledgeStore';
import type { KnowledgeGap } from './types';

function makeGap(args: {
  subject: string;
  categoryGuess?: string | null;
}): KnowledgeGap {
  const now = new Date().toISOString();
  return {
    normalizedSubject: normalizeConciergeText(args.subject).slice(0, 300),
    categoryGuess: args.categoryGuess ?? null,
    hitCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
  };
}

/** In-process (tests). Production callers should use captureKnowledgeGap → SQL. */
export function recordKnowledgeGap(args: {
  subject: string;
  categoryGuess?: string | null;
}): KnowledgeGap {
  if (!isConciergeTestHub()) {
    return makeGap(args);
  }
  const key = normalizeConciergeText(args.subject).slice(0, 300);
  const store = getConciergeStore();
  const now = new Date().toISOString();
  const existing = store.gapsMap.get(key);
  if (existing) {
    existing.hitCount += 1;
    existing.lastSeenAt = now;
    if (args.categoryGuess && !existing.categoryGuess) {
      existing.categoryGuess = args.categoryGuess;
    }
    store.gaps = [...store.gapsMap.values()];
    return existing;
  }
  const gap = makeGap(args);
  store.gapsMap.set(key, gap);
  store.gaps = [...store.gapsMap.values()];
  return gap;
}

export function listKnowledgeGaps(): KnowledgeGap[] {
  if (!isConciergeTestHub()) return [];
  return [...getConciergeStore().gapsMap.values()].sort((a, b) => b.hitCount - a.hitCount);
}

export async function captureKnowledgeGap(args: {
  subject: string;
  categoryGuess?: string | null;
}): Promise<KnowledgeGap> {
  const gap = recordKnowledgeGap(args);
  if (!isConciergeTestHub()) {
    try {
      const { upsertKnowledgeGapSql } = await import('./sqlRepository');
      await upsertKnowledgeGapSql({
        normalizedSubject: gap.normalizedSubject,
        categoryGuess: gap.categoryGuess,
      });
    } catch {
      /* tables may not exist yet */
    }
  }
  return gap;
}
