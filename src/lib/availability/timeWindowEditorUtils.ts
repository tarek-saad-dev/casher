/**
 * Phase 3B — Client-safe time window draft validation for DailyAdjustmentModal.
 */

export type WindowDraft = {
  start: string;
  end: string;
  endDayOffset: 0 | 1;
};

const HHMM_RE = /^\d{2}:\d{2}$/;

export function isValidHhmmClient(v: string): boolean {
  if (!HHMM_RE.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function inferEndDayOffset(start: string, end: string, explicit?: 0 | 1): 0 | 1 {
  if (explicit === 0 || explicit === 1) return explicit;
  if (!isValidHhmmClient(start) || !isValidHhmmClient(end)) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em <= sh * 60 + sm ? 1 : 0;
}

export function isZeroDurationWindow(w: WindowDraft): boolean {
  if (!isValidHhmmClient(w.start) || !isValidHhmmClient(w.end)) return true;
  if (w.endDayOffset === 1) return false;
  return w.start === w.end;
}

export function normalizeWindowDraft(w: Partial<WindowDraft>): WindowDraft | null {
  const start = typeof w.start === 'string' ? w.start : '';
  const end = typeof w.end === 'string' ? w.end : '';
  if (!isValidHhmmClient(start) || !isValidHhmmClient(end)) return null;
  const endDayOffset = inferEndDayOffset(start, end, w.endDayOffset);
  const draft: WindowDraft = { start, end, endDayOffset };
  if (isZeroDurationWindow(draft)) return null;
  return draft;
}

export function windowDraftKey(w: WindowDraft): string {
  return `${w.start}|${w.end}|${w.endDayOffset}`;
}

export function findDuplicateWindows(windows: WindowDraft[]): boolean {
  const seen = new Set<string>();
  for (const w of windows) {
    const k = windowDraftKey(w);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

export type WindowValidationResult =
  | { ok: true; windows: WindowDraft[]; overlapWarning: boolean }
  | { ok: false; message: string };

export function validateWindowDrafts(
  windows: WindowDraft[],
  opts: { required: boolean; forbidden: boolean },
): WindowValidationResult {
  if (opts.forbidden && windows.length > 0) {
    return { ok: false, message: 'إغلاق اليوم لا يقبل نوافذ زمنية' };
  }
  if (opts.required && windows.length === 0) {
    return { ok: false, message: 'أضف نافذة زمنية واحدة على الأقل' };
  }
  const normalized: WindowDraft[] = [];
  for (const w of windows) {
    const n = normalizeWindowDraft(w);
    if (!n) {
      return { ok: false, message: 'نافذة زمنية غير صالحة أو مدتها صفر' };
    }
    normalized.push(n);
  }
  if (findDuplicateWindows(normalized)) {
    return { ok: false, message: 'توجد نوافذ متطابقة مكررة' };
  }
  let overlapWarning = false;
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      const aStart = a.start;
      const aEnd = a.end;
      const bStart = b.start;
      const bEnd = b.end;
      const toMin = (hhmm: string, day: number) => {
        const [h, m] = hhmm.split(':').map(Number);
        return day * 1440 + h * 60 + m;
      };
      const a0 = toMin(aStart, 0);
      const a1 = toMin(aEnd, a.endDayOffset);
      const b0 = toMin(bStart, 0);
      const b1 = toMin(bEnd, b.endDayOffset);
      if (a0 < b1 && b0 < a1) overlapWarning = true;
    }
  }
  return { ok: true, windows: normalized, overlapWarning };
}
