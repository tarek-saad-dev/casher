/**
 * Parse Egyptian Arabic management deltas into DesiredBookingChanges.
 * Uses CI date/time parsers; entity resolution is applied by the caller.
 */
import { resolveCustomerDateText } from '../conversationIntelligence/dateResolve';
import { parseTimePreferenceText } from '../conversationIntelligence/timePreference';
import type { DesiredBookingChanges } from './types';

export type ParsedManagementDeltas = {
  changes: DesiredBookingChanges;
  employeeNameHint: string | null;
  branchNameHint: string | null;
  serviceTextHint: string | null;
  hasAnyDelta: boolean;
};

export function parseManagementDeltas(
  text: string,
  contextTimeHm?: string | null,
): ParsedManagementDeltas {
  const raw = String(text ?? '').trim();
  const changes: DesiredBookingChanges = {};
  let employeeNameHint: string | null = null;
  let branchNameHint: string | null = null;
  let serviceTextHint: string | null = null;

  const dateResolved = resolveCustomerDateText(raw);
  if (dateResolved.date) {
    changes.date = dateResolved.date;
  }

  const timePref = parseTimePreferenceText(raw, { contextTimeHm: contextTimeHm ?? null });
  if (
    timePref?.timeHm &&
    (timePref.kind === 'exact' || timePref.kind === 'around' || /ساعة|ساعه|\d/.test(raw))
  ) {
    changes.time = timePref.timeHm;
  }

  const swap =
    raw.match(/بدل\s+([^\s،,]+)\s+(?:خلي|خليه|ل|الى|إلى)\s+([^\s،,]+)/) ||
    raw.match(/خلي(?:ه|ها)?\s+(?:مع\s+)?([ء-يA-Za-z]{2,20})(?:\s|$)/);
  if (swap) {
    const name = (swap[2] || swap[1] || '').trim();
    if (
      name &&
      !/الساعة|الساعه|بكرة|بكره|جليم|كامب|شعر|دقن|الجمعة|الخميس|السبت/.test(name)
    ) {
      employeeNameHint = name;
      changes.employeeName = name;
    }
  }

  if (/جليم|gleem/i.test(raw)) {
    branchNameHint = 'جليم';
  } else if (/كامب|camp/i.test(raw)) {
    branchNameHint = 'كامب شيزار';
  }

  if (/شعر\s*بس/.test(raw)) serviceTextHint = 'شعر';
  else if (/دقن\s*بس/.test(raw)) serviceTextHint = 'دقن';
  else if (/زود\s*دقن|شعر\s*ودقن/.test(raw)) serviceTextHint = 'شعر ودقن';
  else if (/بدل\s*شعر/.test(raw)) serviceTextHint = 'شعر';

  const hasAnyDelta = Boolean(
    changes.date !== undefined ||
      changes.time !== undefined ||
      changes.employeeName !== undefined ||
      branchNameHint ||
      serviceTextHint,
  );

  return { changes, employeeNameHint, branchNameHint, serviceTextHint, hasAnyDelta };
}
