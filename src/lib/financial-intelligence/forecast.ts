/** Pure cash runway / commitment engine. Dates are Cairo business dates (YYYY-MM-DD). */
export type Frequency = 'once' | 'monthly';
export type CommitmentKind = 'rent' | 'payroll' | 'installment' | 'debt' | 'supplier' | 'utilities' | 'other';
export interface Commitment {
  id: number;
  branchId: number;
  title: string;
  kind: CommitmentKind;
  amount: number;
  dueDate: string;
  frequency: Frequency;
  endDate: string | null;
}
export interface Settlement { commitmentId: number; dueDate: string; amount: number }
export interface DueItem extends Commitment { occurrenceDate: string; remaining: number; paid: number; overdue: boolean }
export interface ForecastDay { date: string; projectedCash: number; due: number; receiptsEstimate: number; operatingOutflowEstimate: number }
export interface ForecastResult {
  dueItems: DueItem[];
  due7: number;
  due14: number;
  due30: number;
  minimumCash30: number | null;
  firstNegativeDay: string | null;
  days: ForecastDay[];
  dataQuality: 'incomplete' | 'estimated';
}
function asDate(s: string): Date {
  const d = new Date(s + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error('Invalid ISO date');
  return d;
}
export function addDays(s: string, days: number): string {
  const d = asDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthlyDate(anchor: string, offset: number): string {
  const a = asDate(anchor);
  const y = a.getUTCFullYear();
  const m = a.getUTCMonth() + offset;
  const monthStart = new Date(Date.UTC(y, m, 1, 12));
  const maxDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 12)).getUTCDate();
  monthStart.setUTCDate(Math.min(a.getUTCDate(), maxDay));
  return monthStart.toISOString().slice(0, 10);
}
function money(v: number): number { return Math.round((v + Number.EPSILON) * 100) / 100; }
export function upcomingCommitments(
  commitments: Commitment[], settlements: Settlement[], today: string, days = 30,
): DueItem[] {
  asDate(today);
  const through = addDays(today, days);
  const paidByKey = new Map<string, number>();
  for (const p of settlements) {
    const key = p.commitmentId + ':' + p.dueDate;
    paidByKey.set(key, money((paidByKey.get(key) || 0) + Number(p.amount || 0)));
  }
  const items: DueItem[] = [];
  for (const c of commitments) {
    if (!Number.isFinite(c.amount) || c.amount <= 0 || !Number.isInteger(c.id)) continue;
    const dates: string[] = [];
    if (c.frequency === 'once') dates.push(c.dueDate);
    else {
      // Explicit cap prevents a corrupt historic seed from generating unbounded occurrences.
      for (let offset = 0; offset < 240; offset++) {
        const date = monthlyDate(c.dueDate, offset);
        if (date > through || (c.endDate && date > c.endDate)) break;
        dates.push(date);
      }
    }
    for (const occurrenceDate of dates) {
      if (occurrenceDate > through) continue;
      const paid = Math.max(0, money(paidByKey.get(c.id + ':' + occurrenceDate) || 0));
      const remaining = money(Math.max(0, c.amount - paid));
      if (remaining === 0) continue;
      items.push({ ...c, occurrenceDate, paid, remaining, overdue: occurrenceDate < today });
    }
  }
  return items.sort((a,b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.id-b.id);
}
export function buildCashForecast(input: {
  today: string;
  bookCash: number | null;
  dailyReceiptsEstimate: number | null;
  dailyOperatingOutflowEstimate: number | null;
  commitments: Commitment[];
  settlements: Settlement[];
}): ForecastResult {
  const { today, bookCash, commitments, settlements } = input;
  const dueItems = upcomingCommitments(commitments, settlements, today, 30);
  const sumThrough = (n: number) => money(dueItems.filter(x => x.occurrenceDate <= addDays(today,n)).reduce((s,x) => s+x.remaining,0));
  const days: ForecastDay[] = [];
  const usable = bookCash !== null && Number.isFinite(bookCash);
  const receipts = Number.isFinite(input.dailyReceiptsEstimate) ? Math.max(0, input.dailyReceiptsEstimate || 0) : 0;
  const outflow = Number.isFinite(input.dailyOperatingOutflowEstimate) ? Math.max(0, input.dailyOperatingOutflowEstimate || 0) : 0;
  let running = usable ? (bookCash as number) : 0;
  let minimumCash30: number | null = usable ? money(running) : null;
  let firstNegativeDay: string | null = null;
  for (let i=0;i<=30;i++) {
    const date = addDays(today,i);
    const due = money(dueItems.filter(x => x.occurrenceDate === date || (i===0 && x.overdue)).reduce((s,x) => s+x.remaining,0));
    const dayReceipts = i===0 ? 0 : receipts;
    const dayOutflows = i===0 ? 0 : outflow;
    running = money(running + dayReceipts - dayOutflows - due);
    if (usable) {
      minimumCash30 = Math.min(minimumCash30 as number, running);
      if (running < 0 && firstNegativeDay === null) firstNegativeDay = date;
    }
    days.push({ date, projectedCash: usable ? running : 0, due, receiptsEstimate: dayReceipts, operatingOutflowEstimate: dayOutflows });
  }
  return {
    dueItems,
    due7: sumThrough(7), due14: sumThrough(14), due30: sumThrough(30),
    minimumCash30, firstNegativeDay, days,
    dataQuality: !usable || input.dailyReceiptsEstimate == null || input.dailyOperatingOutflowEstimate == null ? 'incomplete' : 'estimated',
  };
}
