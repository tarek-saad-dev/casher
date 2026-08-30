/**
 * Open-now evaluation using branch operating hours (live tool data).
 * Pure — no invented hours.
 */
export type OpenNowInput = {
  openTime: string | null; // HH:mm or HH:mm:ss
  closeTime: string | null;
  /** Branch-local "now" as minutes from midnight */
  nowMinutes: number;
};

export type OpenNowResult = {
  isOpen: boolean;
  reason: string;
  openTime: string | null;
  closeTime: string | null;
  nextHint: string | null;
};

function parseHmToMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/** Supports overnight close (e.g. open 12:00, close 01:00). */
export function evaluateOpenNow(input: OpenNowInput): OpenNowResult {
  const openM = parseHmToMinutes(input.openTime);
  const closeM = parseHmToMinutes(input.closeTime);
  if (openM == null || closeM == null) {
    return {
      isOpen: false,
      reason: 'hours_unknown',
      openTime: input.openTime,
      closeTime: input.closeTime,
      nextHint: null,
    };
  }

  const now = input.nowMinutes;
  let isOpen: boolean;
  if (closeM > openM) {
    // Same calendar day window
    isOpen = now >= openM && now < closeM;
  } else {
    // Overnight: open until close next morning
    isOpen = now >= openM || now < closeM;
  }

  const openLabel = input.openTime!.slice(0, 5);
  const closeLabel = input.closeTime!.slice(0, 5);

  if (isOpen) {
    return {
      isOpen: true,
      reason: 'within_hours',
      openTime: openLabel,
      closeTime: closeLabel,
      nextHint: `بنقفل حوالي الساعة ${closeLabel}`,
    };
  }

  return {
    isOpen: false,
    reason: 'outside_hours',
    openTime: openLabel,
    closeTime: closeLabel,
    nextHint: `بنفتح تاني من الساعة ${openLabel}`,
  };
}

export function minutesFromHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
