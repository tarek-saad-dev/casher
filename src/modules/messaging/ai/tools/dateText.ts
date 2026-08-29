import { getCairoBusinessDate, getCairoCalendarDate } from '@/lib/businessDate';

/** Resolve customer date phrases to YYYY-MM-DD in Cairo business context. */
export function resolveCustomerDateText(dateText: string | null | undefined): {
  date: string | null;
  errorCode?: string;
} {
  if (dateText == null || !String(dateText).trim()) {
    return { date: null };
  }
  const raw = String(dateText).trim().toLowerCase();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (iso) return { date: iso[1]! };

  const today = getCairoBusinessDate();
  const calendarToday = getCairoCalendarDate();

  if (
    /^(النهاردة|النهارده|اليوم|today|now)$/i.test(raw) ||
    raw.includes('النهارده') ||
    raw.includes('النهاردة') ||
    raw.includes('اليوم')
  ) {
    return { date: today };
  }
  if (/^(بكرة|بكرا|غدا|غداً|tomorrow)$/i.test(raw) || raw.includes('بكرة') || raw.includes('بكرا')) {
    return { date: addDaysYmd(today, 1) };
  }
  if (raw.includes('بعد بكرة') || raw.includes('بعد بكرا') || /day after/i.test(raw)) {
    return { date: addDaysYmd(today, 2) };
  }

  // dd/mm or dd-mm
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : Number(calendarToday.slice(0, 4));
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { date: null, errorCode: 'INVALID_DATE' };
    }
    return { date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
  }

  return { date: null, errorCode: 'UNPARSED_DATE' };
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function normalizeArabicSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function textMatchesQuery(haystack: string, needle: string): boolean {
  const h = normalizeArabicSearch(haystack);
  const n = normalizeArabicSearch(needle);
  if (!n || !h) return false;
  return h === n || h.includes(n);
}

/** Ranked service match: exact > contains query; avoids reverse substring false positives. */
export function scoreServiceMatch(serviceName: string, query: string): number {
  const h = normalizeArabicSearch(serviceName);
  const n = normalizeArabicSearch(query);
  if (!n || !h) return 0;
  if (h === n) return 100;
  if (h.includes(n)) return 80 - Math.min(40, Math.abs(h.length - n.length));
  return 0;
}

