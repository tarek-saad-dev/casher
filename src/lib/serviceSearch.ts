import type { Service } from '@/lib/types';
import {
  SERVICE_SEARCH_ALIAS_GROUPS,
  type ServiceSearchConcept,
} from '@/lib/serviceSearchAliases';

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const TATWEEL = /\u0640/g;
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Ranking tiers — higher values always beat lower values. */
export const SEARCH_TIER = {
  EXACT_AR: 800,
  EXACT_EN: 750,
  STARTS_WITH: 650,
  WORD_STARTS: 550,
  ALL_TOKENS: 450,
  ALIAS: 350,
  CATEGORY: 250,
  FUZZY: 150,
} as const;

export interface ServiceSearchMatch {
  service: Service;
  score: number;
  tier: number;
}

export interface SearchableServiceRecord {
  service: Service;
  normAr: string;
  normEn: string;
  normCat: string;
  compactAr: string;
  compactEn: string;
  arWords: string[];
  enWords: string[];
  concepts: Set<ServiceSearchConcept>;
  aliasBlob: string;
  searchBlob: string;
}

/**
 * Normalize text for search matching only (not display).
 */
export function normalizeSearchText(value: string): string {
  if (!value) return '';

  let text = value.trim().toLowerCase();

  text = text.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  text = text.replace(ARABIC_DIACRITICS, '');
  text = text.replace(TATWEEL, '');
  text = text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');

  text = text.replace(/[^\w\s\u0600-\u06FF]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/** Compact form treats "hair cut" and "haircut" as equivalent. */
export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function tokenizeQuery(query: string): string[] {
  return splitWords(normalizeSearchText(query));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function fuzzyTokenMatch(token: string, target: string): boolean {
  if (token.length < 2 || target.length < 2) return false;
  if (target.includes(token)) return true;

  const maxDistance =
    token.length <= 3 ? 1 : token.length <= 5 ? 1 : 2;

  if (Math.abs(token.length - target.length) > maxDistance) return false;

  const distance = levenshtein(token, target);
  const threshold = token.length <= 4 ? 0.34 : 0.38;
  return distance / Math.max(token.length, target.length) <= threshold;
}

function resolveConceptsForText(...texts: string[]): Set<ServiceSearchConcept> {
  const concepts = new Set<ServiceSearchConcept>();
  const blob = compactSearchText(texts.join(' '));

  for (const group of SERVICE_SEARCH_ALIAS_GROUPS) {
    for (const term of group.terms) {
      const normTerm = compactSearchText(term);
      if (!normTerm) continue;
      if (blob.includes(normTerm) || texts.some((t) => normalizeSearchText(t).includes(normalizeSearchText(term)))) {
        concepts.add(group.concept);
        break;
      }
    }
  }

  return concepts;
}

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);

  for (const token of tokens) {
    const compactToken = compactSearchText(token);
    for (const group of SERVICE_SEARCH_ALIAS_GROUPS) {
      const matched = group.terms.some((term) => {
        const normTerm = normalizeSearchText(term);
        const compactTerm = compactSearchText(term);
        return (
          normTerm === token ||
          compactTerm === compactToken ||
          normTerm.includes(token) ||
          token.includes(normTerm) ||
          compactTerm.includes(compactToken)
        );
      });
      if (matched) {
        for (const term of group.terms) {
          expanded.add(normalizeSearchText(term));
          expanded.add(compactSearchText(term));
        }
      }
    }
  }

  return Array.from(expanded).filter(Boolean);
}

function buildAliasBlob(concepts: Set<ServiceSearchConcept>): string {
  const terms: string[] = [];
  for (const concept of concepts) {
    const group = SERVICE_SEARCH_ALIAS_GROUPS.find((g) => g.concept === concept);
    if (group) {
      for (const term of group.terms) {
        terms.push(normalizeSearchText(term));
        terms.push(compactSearchText(term));
      }
    }
  }
  return terms.join(' ');
}

export function buildSearchableService(service: Service): SearchableServiceRecord {
  const arName = service.ProNameAr || '';
  const enName = service.ProName || '';
  const catName = service.CatName || '';

  const normAr = normalizeSearchText(arName);
  const normEn = normalizeSearchText(enName);
  const normCat = normalizeSearchText(catName);
  const compactAr = compactSearchText(arName);
  const compactEn = compactSearchText(enName);

  const concepts = resolveConceptsForText(arName, enName, catName);
  const aliasBlob = buildAliasBlob(concepts);

  return {
    service,
    normAr,
    normEn,
    normCat,
    compactAr,
    compactEn,
    arWords: splitWords(normAr),
    enWords: splitWords(normEn),
    concepts,
    aliasBlob,
    searchBlob: [normAr, normEn, normCat, aliasBlob].filter(Boolean).join(' '),
  };
}

export function buildSearchableServices(services: Service[]): SearchableServiceRecord[] {
  return services.map(buildSearchableService);
}

function countMatchedTokens(
  tokens: string[],
  expandedTokens: string[],
  searchBlob: string,
): number {
  const compactBlob = compactSearchText(searchBlob);
  const uniqueTokens = [...new Set(tokens)];

  return uniqueTokens.filter((token) => {
    const compactToken = compactSearchText(token);
    const tokenVariants = expandedTokens.filter(
      (t) => t === token || t === compactToken || t.includes(token) || token.includes(t),
    );

    return (
      tokenMatchesField(token, searchBlob, compactBlob) ||
      tokenVariants.some((variant) =>
        tokenMatchesField(variant, searchBlob, compactBlob),
      )
    );
  }).length;
}

function tokenMatchesField(token: string, field: string, compactField: string): boolean {
  const compactToken = compactSearchText(token);
  if (!token) return false;
  if (field.includes(token) || compactField.includes(compactToken)) return true;
  return fuzzyTokenMatch(token, field) || fuzzyTokenMatch(compactToken, compactField);
}

function scoreSearchableService(
  record: SearchableServiceRecord,
  normQuery: string,
  compactQuery: string,
  tokens: string[],
  expandedTokens: string[],
): ServiceSearchMatch | null {
  const { normAr, normEn, normCat, compactAr, compactEn, arWords, enWords, searchBlob, aliasBlob } =
    record;

  let tier = 0;
  let subScore = 0;

  // 1–2. Exact normalized name matches
  if (normAr && normAr === normQuery) {
    tier = SEARCH_TIER.EXACT_AR;
    subScore = 100;
  } else if (normEn && (normEn === normQuery || compactEn === compactQuery)) {
    tier = SEARCH_TIER.EXACT_EN;
    subScore = 100;
  } else if (
    normAr.startsWith(normQuery) ||
    normEn.startsWith(normQuery) ||
    compactEn.startsWith(compactQuery) ||
    compactAr.startsWith(compactQuery)
  ) {
    // 3. Prefix match on full query
    tier = SEARCH_TIER.STARTS_WITH;
    subScore = 80;
  } else if (tokens.length === 1) {
    const token = tokens[0];
    const wordStarts =
      arWords.some((w) => w.startsWith(token)) ||
      enWords.some((w) => w.startsWith(token)) ||
      arWords.some((w) => compactSearchText(w).startsWith(compactSearchText(token))) ||
      enWords.some((w) => compactSearchText(w).startsWith(compactSearchText(token)));

    if (wordStarts) {
      tier = SEARCH_TIER.WORD_STARTS;
      subScore = 70;
    }
  }

  // 5. Multi-token / contains-all matching
  if (tokens.length > 0) {
    const uniqueTokens = [...new Set(tokens)];
    const matchedCount = countMatchedTokens(uniqueTokens, expandedTokens, searchBlob);

    if (matchedCount === uniqueTokens.length) {
      const tokenTier = SEARCH_TIER.ALL_TOKENS;
      const tokenSubScore = 50 + matchedCount * 10;
      if (tokenTier > tier) {
        tier = tokenTier;
        subScore = tokenSubScore;
      } else if (tokenTier === tier) {
        subScore = Math.max(subScore, tokenSubScore);
      }
    } else if (tokens.length > 1) {
      // Multi-word queries require every token to match (AND logic).
      if (tier === 0) return null;
    }
  }

  // 6. Alias / synonym match
  if (tier === 0 || tier <= SEARCH_TIER.ALIAS) {
    const aliasHit = tokens.some((token) => {
      const compactToken = compactSearchText(token);
      return (
        aliasBlob.includes(token) ||
        aliasBlob.includes(compactToken) ||
        tokenMatchesField(token, aliasBlob, compactSearchText(aliasBlob))
      );
    });

    if (aliasHit && record.concepts.size > 0) {
      const aliasTier = SEARCH_TIER.ALIAS;
      const aliasSubScore = 40;
      if (aliasTier > tier) {
        tier = aliasTier;
        subScore = aliasSubScore;
      } else if (aliasTier === tier) {
        subScore = Math.max(subScore, aliasSubScore);
      }
    }
  }

  // 7. Category match
  if (tier === 0 && normCat) {
    const catHit =
      normCat.includes(normQuery) ||
      tokens.some((token) => normCat.includes(token) || fuzzyTokenMatch(token, normCat));

    if (catHit) {
      tier = SEARCH_TIER.CATEGORY;
      subScore = 30;
    }
  }

  // 8. Fuzzy fallback — only for queries >= 2 chars, conservative
  if (tier === 0 && normQuery.length >= 2) {
    const fuzzyTargets = [...arWords, ...enWords];
    const fuzzyHit =
      fuzzyTargets.some((word) => fuzzyTokenMatch(normQuery, word)) ||
      fuzzyTokenMatch(normQuery, normAr) ||
      fuzzyTokenMatch(normQuery, normEn);

    if (fuzzyHit) {
      tier = SEARCH_TIER.FUZZY;
      subScore = 20;
    }
  }

  if (tier === 0) return null;

  if (tokens.length > 1) {
    const matchedCount = countMatchedTokens(tokens, expandedTokens, searchBlob);
    if (matchedCount < tokens.length && tier < SEARCH_TIER.ALL_TOKENS) {
      return null;
    }
  }

  return {
    service: record.service,
    tier,
    score: tier * 1000 + subScore,
  };
}

/**
 * Filter and rank services by query.
 * Returns the input list unchanged when query is empty.
 */
export function searchServices(
  services: Service[],
  query: string,
): Service[] {
  const trimmed = query.trim();
  if (!trimmed) return services;

  const normQuery = normalizeSearchText(trimmed);
  const compactQuery = compactSearchText(trimmed);
  const tokens = tokenizeQuery(trimmed);

  if (tokens.length === 0) return services;

  const expandedTokens = expandQueryTokens(tokens);
  const searchable = buildSearchableServices(services);

  const ranked: Array<ServiceSearchMatch & { originalIndex: number }> = [];

  searchable.forEach((record, originalIndex) => {
    const match = scoreSearchableService(
      record,
      normQuery,
      compactQuery,
      tokens,
      expandedTokens,
    );
    if (match) {
      ranked.push({ ...match, originalIndex });
    }
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });

  return ranked.map((entry) => entry.service);
}

/**
 * Resolve visible services for the POS catalog.
 * - Empty query → category-filtered list (unchanged category behavior)
 * - Active query → search the full services collection
 */
export function resolveVisibleServices(
  allServices: Service[],
  categoryServices: Service[],
  query: string,
): Service[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return categoryServices;
  }
  return searchServices(allServices, normalizedQuery);
}
