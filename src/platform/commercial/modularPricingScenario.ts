import { SALON_PACK } from '@/packs/salon/public';
import { getAppInstallDependencies, isSelfServiceAvailableAppCode } from '@/platform/apps/appCatalog';

/**
 * RESEARCH SCENARIO ONLY — NOT an offer/quote, public price catalog, subscription grant or
 * payment instruction. This pure calculator is used ONLY by platform operators to compare
 * possible modular business models. Values are UNAPPROVED hypotheses as of 2026-10-26.
 */
export const RESEARCH_SCENARIO_VERSION = 'salon-modular-research-2026-10-26' as const;

const RESEARCH_RATES = {
  booking: 199,
  queue: 99,
  pos: 299,
  attendance: 99,
  payroll: 199,
  treasury: 99,
  reports: 149,
} as const;

const HOLD_APPS = new Set(['inventory', 'purchasing', 'messaging', 'ai-receptionist', 'loyalty']);
const SALON_CODES = new Set<string>([...SALON_PACK.required, ...SALON_PACK.recommended, ...SALON_PACK.optional]);
const MONTHS_PER_YEAR = 10; // Research hypothesis, not an approved customer discount
const EXPERIMENTAL_BRANCH_FEE = 199; // Research hypothesis, not a tariff
const MAX_BRANCHES_SCENARIO = 10;

export type ScenarioCycle = 'monthly' | 'annual';
export type ScenarioInput = {
  industry: string;
  apps: readonly string[];
  branches: number;
  cycle: ScenarioCycle;
};
export type ScenarioLine = { code: string; label: string; quantity: number; monthlyEgp: number };
export type ResearchScenario = {
  mode: 'research_only';
  version: typeof RESEARCH_SCENARIO_VERSION;
  canCheckout: false;
  canActivate: false;
  currency: 'EGP';
  industry: 'salon';
  cycle: ScenarioCycle;
  apps: string[];
  branches: number;
  lines: ScenarioLine[];
  monthlyEgp: number;
  illustrativePeriodEgp: number;
  yearlyMonthsCharged: typeof MONTHS_PER_YEAR;
  note: string;
};
export class ResearchScenarioError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ResearchScenarioError';
  }
}

/**
 * Reject unknown, legacy-only, unready and dependency-incomplete combinations.
 * Refuse silently pricing an unverified app as 0 EGP. Required booking is included exactly once.
 */
export function calculateSalonResearchScenario(input: ScenarioInput): ResearchScenario {
  if (input.industry !== 'salon') {
    throw new ResearchScenarioError('INDUSTRY_UNSUPPORTED', 'التجربة البحثية متاحة للصالونات فقط حاليًا');
  }
  if (input.cycle !== 'monthly' && input.cycle !== 'annual') {
    throw new ResearchScenarioError('CYCLE_INVALID', 'مدة الاشتراك غير مدعومة');
  }
  if (!Number.isSafeInteger(input.branches) || input.branches < 1 || input.branches > MAX_BRANCHES_SCENARIO) {
    throw new ResearchScenarioError('BRANCH_COUNT_INVALID', 'عدد الفروع للتجربة من 1 إلى 10');
  }
  if (!Array.isArray(input.apps) || input.apps.length > SALON_CODES.size ||
      input.apps.some((x) => typeof x !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(x))) {
    throw new ResearchScenarioError('APPS_INVALID', 'اختيارات التطبيقات غير صحيحة');
  }
  const apps = [...input.apps];
  const unique = new Set(apps);
  if (unique.size !== apps.length) {
    throw new ResearchScenarioError('APPS_DUPLICATED', 'ممنوع تكرار تكلفة التطبيق');
  }
  for (const required of SALON_PACK.required) {
    if (!unique.has(required)) throw new ResearchScenarioError('REQUIRED_APP_MISSING', 'الحجز أساسي لنشاط الصالون');
  }
  for (const code of apps) {
    if (!SALON_CODES.has(code) || HOLD_APPS.has(code) || !isSelfServiceAvailableAppCode(code) ||
        !Object.hasOwn(RESEARCH_RATES, code)) {
      throw new ResearchScenarioError('APP_NOT_PRICEABLE', 'التطبيق غير جاهز لتقييم سعر تجاري في هذا النموذج: ' + code);
    }
    for (const dependency of getAppInstallDependencies(code as Parameters<typeof getAppInstallDependencies>[0])) {
      if (!unique.has(dependency)) {
        throw new ResearchScenarioError('MISSING_DEPENDENCY', code + ' يحتاج ' + dependency);
      }
    }
  }
  const labels: Record<keyof typeof RESEARCH_RATES, string> = {
    booking: 'الحجوزات', queue: 'الدور', pos: 'الكاشير',
    attendance: 'الحضور', payroll: 'الرواتب', treasury: 'الخزنة', reports: 'التقارير',
  };
  const lines: ScenarioLine[] = apps.sort().map((code) => ({
    code,
    label: labels[code as keyof typeof RESEARCH_RATES],
    quantity: 1,
    monthlyEgp: RESEARCH_RATES[code as keyof typeof RESEARCH_RATES],
  }));
  if (input.branches > 1) {
    lines.push({
      code: 'extra-branch',
      label: 'فروع إضافية (فرضية بحثية)',
      quantity: input.branches - 1,
      monthlyEgp: EXPERIMENTAL_BRANCH_FEE * (input.branches - 1),
    });
  }
  const monthlyEgp = lines.reduce((sum, x) => sum + x.monthlyEgp, 0);
  return {
    mode: 'research_only',
    version: RESEARCH_SCENARIO_VERSION,
    canCheckout: false,
    canActivate: false,
    currency: 'EGP',
    industry: 'salon',
    cycle: input.cycle,
    apps: apps.sort(),
    branches: input.branches,
    lines,
    monthlyEgp,
    illustrativePeriodEgp: monthlyEgp * (input.cycle === 'annual' ? MONTHS_PER_YEAR : 1),
    yearlyMonthsCharged: MONTHS_PER_YEAR,
    note: 'الأرقام فرضيات بحثية للإدارة فقط، لا تشمل الضرائب أو رسوم البوابات؛ ليست عرض سعر أو مبلغ مستحق.',
  };
}

/** Allows the operator UI to offer ONLY research-priceable apps. */
export const SALON_RESEARCH_APP_OPTIONS = Object.entries(RESEARCH_RATES).map(([code, monthlyEgp]) => ({
  code,
  monthlyEgp,
  required: SALON_PACK.required.includes(code as 'booking'),
})) as ReadonlyArray<{ code: string; monthlyEgp: number; required: boolean }>;
