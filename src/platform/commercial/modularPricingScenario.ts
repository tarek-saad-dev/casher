import { SALON_PACK } from '@/packs/salon/public';
import { getAppInstallDependencies } from '@/platform/apps/appCatalog';
import {
  calculateModularResearchQuote,
  minorToEgp,
  ModularQuoteError,
  type ModularResearchCatalog,
  type ModularResearchRules,
} from './modularQuoteEngine';

/**
 * SERVER-SELECTED RESEARCH ASSUMPTIONS. No customer price, subscription grant,
 * approval, gateway integration or public payment intent may use this catalog.
 */
export const RESEARCH_SCENARIO_VERSION = 'salon-modular-research-2026-10-26' as const;

const RESEARCH_RATES = {
  booking: 199, queue: 99, pos: 299, attendance: 99,
  payroll: 199, treasury: 99, reports: 149,
} as const;
const MONTHS_PER_YEAR = 10 as const;
const EXPERIMENTAL_BRANCH_FEE = 199;
const MAX_BRANCHES_SCENARIO = 10;

const LABELS: Record<keyof typeof RESEARCH_RATES, string> = {
  booking: 'الحجوزات', queue: 'الدور', pos: 'الكاشير',
  attendance: 'الحضور', payroll: 'الرواتب',
  treasury: 'الخزنة', reports: 'التقارير',
};
const appCodes = Object.keys(RESEARCH_RATES);
const perAppCatalog: ModularResearchCatalog = {
  catalogId: 'salon-modular-research',
  version: 1,
  state: 'research_only',
  industry: 'salon',
  currency: 'EGP',
  monthlyPerAppMinor: Object.fromEntries(Object.entries(RESEARCH_RATES).map(([code, egp]) => [code, egp * 100])),
  includedBranches: 1,
  baseMonthlyMinor: 0,
  extraBranchMonthlyMinor: EXPERIMENTAL_BRANCH_FEE * 100,
  maxBranches: MAX_BRANCHES_SCENARIO,
  annualMonthsCharged: MONTHS_PER_YEAR,
};

const basePlusAppsCatalog: ModularResearchCatalog = {
  ...perAppCatalog,
  catalogId: 'salon-base-plus-apps-research',
  baseMonthlyMinor: 14900,
  monthlyPerAppMinor: Object.fromEntries(Object.entries(RESEARCH_RATES).map(([code, egp]) => [
    code, egp * 80, // All research rate figures stay integer piasters
  ])),
};

export type ScenarioModel = 'per_app' | 'base_plus_apps';
const CATALOGS: Record<ScenarioModel, ModularResearchCatalog> = {
  per_app: perAppCatalog,
  base_plus_apps: basePlusAppsCatalog,
};

const rules: ModularResearchRules = {
  requiredApps: [...SALON_PACK.required],
  eligibleApps: appCodes,
  dependencies: Object.fromEntries(appCodes.map((code) => [
    code, [...getAppInstallDependencies(code as Parameters<typeof getAppInstallDependencies>[0])],
  ])),
  labels: LABELS,
};

export type ScenarioCycle = 'monthly' | 'annual';
export type ScenarioInput = {
  industry: string;
  apps: readonly string[];
  branches: number;
  cycle: ScenarioCycle;
  model?: ScenarioModel;
};
export type ScenarioLine = { code: string; label: string; quantity: number; monthlyEgp: number };
export type ResearchScenario = {
  mode: 'research_only';
  version: typeof RESEARCH_SCENARIO_VERSION;
  catalogVersion: number;
  model: ScenarioModel;
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
 * Reuses the generic integer-minor-unit engine. Unknown apps, duplicate charges,
 * missing pack requirements and dependencies fail closed. No pricing from client input.
 */
export function calculateSalonResearchScenario(input: ScenarioInput): ResearchScenario {
  try {
    const model: ScenarioModel = input.model ?? 'per_app';
    if (!Object.prototype.hasOwnProperty.call(CATALOGS, model)) {
      throw new ResearchScenarioError('MODEL_INVALID', 'النموذج البحثي غير متاح');
    }
    const quote = calculateModularResearchQuote(input, CATALOGS[model], rules);
    return {
      mode: 'research_only',
      version: RESEARCH_SCENARIO_VERSION,
      catalogVersion: quote.catalogVersion,
      model,
      canCheckout: false,
      canActivate: false,
      currency: 'EGP',
      industry: 'salon',
      cycle: quote.cycle,
      apps: quote.apps,
      branches: quote.branches,
      lines: quote.lines.map((line) => ({
        code: line.code,
        label: line.code === 'extra-branch' ? 'فروع إضافية (فرضية بحثية)'
          : line.code === 'platform-base' ? 'رسوم أساسية للمنصة (فرضية بحثية)'
          : line.label,
        quantity: line.quantity,
        monthlyEgp: minorToEgp(line.totalMonthlyMinor),
      })),
      monthlyEgp: minorToEgp(quote.totalMonthlyMinor),
      illustrativePeriodEgp: minorToEgp(quote.totalPeriodMinor),
      yearlyMonthsCharged: MONTHS_PER_YEAR,
      note: 'الأرقام فرضيات بحثية للإدارة فقط، لا تشمل الضرائب أو رسوم البوابات؛ ليست عرض سعر أو مبلغ مستحق.',
    };
  } catch (error) {
    if (error instanceof ModularQuoteError) {
      throw new ResearchScenarioError(error.code, error.message);
    }
    throw error;
  }
}

/** Only researched (not necessarily market-ready) app codes are exposed in the operator UI. */
export const SALON_RESEARCH_APP_OPTIONS = Object.entries(RESEARCH_RATES).map(([code, monthlyEgp]) => ({
  code, monthlyEgp, required: SALON_PACK.required.includes(code as 'booking'),
})) as ReadonlyArray<{ code: string; monthlyEgp: number; required: boolean }>;
