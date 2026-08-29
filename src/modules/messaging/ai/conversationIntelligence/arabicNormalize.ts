/**
 * Conversation Intelligence V2 — Egyptian Arabic text normalization for matching.
 * Safe, conservative; do not over-normalize unrelated words.
 */
export function normalizeArabicSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    // Common service/name spelling: ذقن ↔ دقن
    .replace(/ذقن/g, 'دقن')
    // Strip Arabic/Latin punctuation to spaces
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    // Collapse conjunction spacing: "شعر و دقن" → "شعرودقن" matching path via tokens
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compact form: remove spaces around و/+ and all remaining spaces for equality checks. */
export function compactArabicTokens(text: string): string {
  const n = normalizeArabicSearch(text);
  return n
    .replace(/\s*([و+])\s*/g, '$1')
    .replace(/\s+/g, '')
    .trim();
}

/** Token list after normalization (split on spaces). */
export function arabicTokens(text: string): string[] {
  const n = normalizeArabicSearch(text);
  if (!n) return [];
  return n.split(' ').filter(Boolean);
}

/**
 * Service/catalog match score.
 * exact compact > exact normalized > contains > token overlap.
 */
export function scoreServiceMatch(serviceName: string, query: string): number {
  const h = normalizeArabicSearch(serviceName);
  const n = normalizeArabicSearch(query);
  if (!n || !h) return 0;

  const hc = compactArabicTokens(serviceName);
  const nc = compactArabicTokens(query);
  if (hc && nc && hc === nc) return 100;
  if (h === n) return 98;

  // Long utterance containing the service: "عاوز شعر و دقن مع عمر"
  if (hc && nc && nc.includes(hc) && hc.length >= 4) {
    return 92;
  }

  // "شعر و دقن" vs "شعر ودقن"
  if (hc && nc && (hc.includes(nc) || nc.includes(hc))) {
    return 90 - Math.min(30, Math.abs(hc.length - nc.length));
  }
  if (h.includes(n)) return 80 - Math.min(40, Math.abs(h.length - n.length));
  if (n.includes(h) && h.length >= 4) return 88;

  // Treat + as و before tokenizing
  const nPlus = normalizeArabicSearch(query.replace(/\+/g, ' و '));
  const ncPlus = compactArabicTokens(query.replace(/\+/g, ' و '));
  if (hc && ncPlus && (hc === ncPlus || ncPlus.includes(hc) || hc.includes(ncPlus))) {
    return 90;
  }

  // Token-aware: significant query tokens (drop fillers) present in service
  const fillers = new Set([
    'عاوز',
    'عايز',
    'عايزة',
    'احجز',
    'أحجز',
    'حجز',
    'مع',
    'فرع',
    'انهرده',
    'النهارده',
    'بكره',
    'بكرة',
    'الساعة',
    'الساعه',
    'بليل',
    'بالليل',
    'حوالي',
    'بس',
    'طيب',
    'ان',
    'انا',
    'اليوم',
  ]);
  const qTokens = arabicTokens(nPlus || n).filter((t) => t !== 'و' && !fillers.has(t) && !/^\d+$/.test(t));
  const sTokens = arabicTokens(serviceName);
  if (qTokens.length >= 2) {
    const serviceRelevant = qTokens.filter((qt) =>
      sTokens.some((st) => st === qt || st.includes(qt) || qt.includes(st)),
    );
    if (serviceRelevant.length >= 2) return 85;
  }

  // "شعر بس" → prefer hair-only
  if (/^(شعر)\s*(بس|فقط)?$/.test(n) || n === 'شعر') {
    if (/^شعر$/.test(h) || (/شعر/.test(h) && !/دقن|ذقن/.test(h))) return 75;
    if (/شعر/.test(h) && /دقن/.test(h)) return 40;
  }

  if (qTokens.length === 1) {
    const qt = qTokens[0]!;
    if (sTokens.some((st) => st === qt)) return 70;
    if (h.includes(qt) && qt.length >= 3) return 55;
  }

  return 0;
}

export function textMatchesQuery(haystack: string, needle: string): boolean {
  return scoreServiceMatch(haystack, needle) >= 55;
}

/** Strip filler booking verbs for entity extraction helpers. */
export function stripBookingFillers(text: string): string {
  return normalizeArabicSearch(text)
    .replace(/\b(عاوز|عايز|عايزه|عاوزة|احب|أحجز|احجز|حجز|مع|فرع|انه|ان)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
