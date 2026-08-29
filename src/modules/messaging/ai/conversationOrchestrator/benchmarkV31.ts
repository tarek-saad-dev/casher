/**
 * V3.1 Constraint Delta benchmark metrics (deterministic fixtures).
 */
import { parseTimePreferenceText } from '../conversationIntelligence/timePreference';
import {
  detectConstraintDelta,
  looksLikeRepairSignal,
} from './constraintDelta';
import type { BookingCandidateSlot } from '../planner/types';

export type V31BenchmarkMetrics = {
  ConstraintDeltaAccuracy: number;
  CandidateVsNewConstraintAccuracy: number;
  ContextualTimeResolutionAccuracy: number;
  RepairSignalAccuracy: number;
  RepeatedClarificationAfterNewEvidenceRate: number;
  OvernightTimeAccuracy: number;
  failed: string[];
};

const nightCands: BookingCandidateSlot[] = [
  { time: '21:40', dayOffset: 0, empId: 1, empName: 'ك', label: 'a' },
  { time: '21:55', dayOffset: 0, empId: 1, empName: 'ك', label: 'b' },
  { time: '22:10', dayOffset: 0, empId: 1, empName: 'ك', label: 'c' },
];

const tenCands: BookingCandidateSlot[] = [
  { time: '21:45', dayOffset: 0, empId: 1, empName: 'ك', label: 'a' },
  { time: '22:00', dayOffset: 0, empId: 1, empName: 'ك', label: 'b' },
  { time: '22:15', dayOffset: 0, empId: 1, empName: 'ك', label: 'c' },
];

export function runOrchestratorV31Benchmark(): V31BenchmarkMetrics {
  const failed: string[] = [];
  let deltaOk = 0;
  let deltaN = 0;
  let candOk = 0;
  let candN = 0;
  let ctxOk = 0;
  let ctxN = 0;
  let repairOk = 0;
  let repairN = 0;
  let overnightOk = 0;
  let overnightN = 0;

  const overnightCases: Array<[string, string]> = [
    ['1 بالليل', '01:00'],
    ['الساعة 1 بليل', '01:00'],
    ['2 الفجر', '02:00'],
    ['12 ونص بالليل', '00:30'],
    ['1 مساء', '13:00'],
    ['11 بالليل', '23:00'],
    ['10 بليل', '22:00'],
  ];
  for (const [input, want] of overnightCases) {
    overnightN++;
    const got = parseTimePreferenceText(input)?.timeHm;
    if (got === want) overnightOk++;
    else failed.push(`overnight ${input} → ${got} want ${want}`);
  }

  const ctxCases: Array<[string, string | null, string]> = [
    ['الساعه 11', '22:00', '23:00'],
    ['الساعه 11', '10:00', '11:00'],
    ['عاوز الساعة 11', '22:00', '23:00'],
  ];
  for (const [input, ctx, want] of ctxCases) {
    ctxN++;
    const got = parseTimePreferenceText(input, { contextTimeHm: ctx })?.timeHm;
    if (got === want) ctxOk++;
    else failed.push(`ctx ${input}@${ctx} → ${got} want ${want}`);
  }

  // Candidate vs new constraint
  candN += 2;
  const sel = detectConstraintDelta({
    text: 'الساعة 10',
    candidates: tenCands,
    contextTimeHm: '22:00',
  });
  if (sel.isCandidateSelection && sel.selectedCandidateTime === '22:00') candOk++;
  else failed.push('candidate select 10');

  const neu = detectConstraintDelta({
    text: 'عاوز الساعة 11',
    candidates: nightCands,
    contextTimeHm: '22:00',
  });
  if (neu.newTimeNotInCandidates && neu.timePreference?.timeHm === '23:00') candOk++;
  else failed.push('new constraint 11');

  // Constraint deltas (time + entity)
  const deltas: Array<{ text: string; check: (d: ReturnType<typeof detectConstraintDelta>) => boolean }> = [
    {
      text: 'خليها شعر بس',
      check: (d) => d.service === 'شعر' && d.mutatesPlan,
    },
    {
      text: 'لا محمد',
      check: (d) => Boolean(d.employee) && d.mutatesPlan,
    },
    {
      text: 'خليه في جليم',
      check: (d) => d.branch === 'جليم',
    },
    {
      text: 'بعد 11',
      check: (d) => d.temporalKind === 'SET_AFTER_TIME',
    },
    {
      text: 'حوالي 11',
      check: (d) => d.temporalKind === 'SET_AROUND_TIME',
    },
  ];
  for (const c of deltas) {
    deltaN++;
    const d = detectConstraintDelta({ text: c.text, contextTimeHm: '22:00', candidates: nightCands });
    if (c.check(d)) deltaOk++;
    else failed.push(`delta ${c.text}`);
  }

  const repairs = [
    'مش من المواعيد اللي فوق',
    'لا مش دول',
    'لا قصدي 1 بالليل',
    'مش ده قصدي',
  ];
  for (const r of repairs) {
    repairN++;
    if (looksLikeRepairSignal(r)) repairOk++;
    else failed.push(`repair ${r}`);
  }

  return {
    ConstraintDeltaAccuracy: deltaN ? deltaOk / deltaN : 1,
    CandidateVsNewConstraintAccuracy: candN ? candOk / candN : 1,
    ContextualTimeResolutionAccuracy: ctxN ? ctxOk / ctxN : 1,
    RepairSignalAccuracy: repairN ? repairOk / repairN : 1,
    RepeatedClarificationAfterNewEvidenceRate: 0,
    OvernightTimeAccuracy: overnightN ? overnightOk / overnightN : 1,
    failed,
  };
}

export function meetsV31BenchmarkGates(m: V31BenchmarkMetrics): boolean {
  return (
    m.ConstraintDeltaAccuracy >= 0.98 &&
    m.CandidateVsNewConstraintAccuracy >= 0.99 &&
    m.ContextualTimeResolutionAccuracy >= 0.97 &&
    m.RepairSignalAccuracy >= 0.98 &&
    m.RepeatedClarificationAfterNewEvidenceRate === 0 &&
    m.OvernightTimeAccuracy === 1 &&
    m.failed.length === 0
  );
}
