/**
 * Conversation Intelligence — Egyptian date phrase resolution.
 * Re-exports / extends tools/dateText with dialect coverage (انهرده, …).
 */
import { getCairoBusinessDate, getCairoCalendarDate } from '@/lib/businessDate';

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const WEEKDAYS: Record<string, number> = {
  الاحد: 0,
  الأحد: 0,
  الاثنين: 1,
  الإثنين: 1,
  الثلاثاء: 2,
  الاربعاء: 3,
  الأربعاء: 3,
  الخميس: 4,
  الجمعه: 5,
  الجمعة: 5,
  السبت: 6,
};

/** Next occurrence of weekday (0=Sun) on/after Cairo calendar today. */
function nextWeekdayYmd(fromYmd: string, targetDow: number): string {
  const [y, m, d] = fromYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const current = dt.getUTCDay();
  let delta = (targetDow - current + 7) % 7;
  if (delta === 0) delta = 7; // "الجمعة الجاية" → next week if today is Friday? Prefer same-day if still open — use 0 for same day
  // For "الجمعة" without الجاية: same week including today
  return addDaysYmd(fromYmd, (targetDow - current + 7) % 7);
}

function nextWeekdayStrict(fromYmd: string, targetDow: number): string {
  const [y, m, d] = fromYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const current = dt.getUTCDay();
  let delta = (targetDow - current + 7) % 7;
  if (delta === 0) delta = 7;
  return addDaysYmd(fromYmd, delta);
}

/**
 * Resolve customer date phrases to YYYY-MM-DD in Cairo business context.
 */
export function resolveCustomerDateText(dateText: string | null | undefined): {
  date: string | null;
  errorCode?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
} {
  if (dateText == null || !String(dateText).trim()) {
    return { date: null };
  }
  const raw = String(dateText).trim().toLowerCase();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (iso) return { date: iso[1]!, confidence: 'HIGH' };

  const today = getCairoBusinessDate();
  const calendarToday = getCairoCalendarDate();

  // Today variants (incl. common misspelling انهرده)
  if (
    /^(النهاردة|النهارده|انهرده|انهاردة|انهارده|اليوم|today|now)$/i.test(raw) ||
    /النهارده|النهاردة|انهرده|انهاردة|انهارده|اليوم/.test(raw)
  ) {
    return { date: today, confidence: 'HIGH' };
  }

  // Day after tomorrow before tomorrow (substring order)
  if (
    /بعد\s*بكر[ةا]|بعد\s*بكره|day after/i.test(raw)
  ) {
    return { date: addDaysYmd(today, 2), confidence: 'HIGH' };
  }

  if (
    /^(بكرة|بكره|بكرا|غدا|غداً|tomorrow)$/i.test(raw) ||
    /(^|[\s،,])(بكرة|بكره|بكرا)([\s،,]|$)/.test(raw) ||
    raw.includes('بكرة') ||
    raw.includes('بكره') ||
    raw.includes('بكرا')
  ) {
    // Avoid matching "بعد بكرة" — already handled
    if (!/بعد\s*بكر/.test(raw)) {
      return { date: addDaysYmd(today, 1), confidence: 'HIGH' };
    }
  }

  // Weekday + optional الجاية
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (raw.includes(name)) {
      const nextWeek = /الجاي[ةه]?|القادم|الجایة/.test(raw);
      const date = nextWeek
        ? nextWeekdayStrict(calendarToday, dow)
        : nextWeekdayYmd(calendarToday, dow);
      return { date, confidence: 'MEDIUM' };
    }
  }

  // dd/mm or dd-mm
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : Number(calendarToday.slice(0, 4));
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { date: null, errorCode: 'INVALID_DATE', confidence: 'LOW' };
    }
    return {
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      confidence: 'HIGH',
    };
  }

  return { date: null, errorCode: 'UNPARSED_DATE', confidence: 'LOW' };
}
