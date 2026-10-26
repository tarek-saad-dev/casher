/**
 * DRVO ERP modular commercial maths — PURE, RESEARCH-ONLY domain engine.
 *
 * All prices use integer EGP piasters (minor units); display conversion happens last.
 * There is intentionally NO payable/approved/active quote output.
 * This module does not check subscriptions, persist data, grant apps, or collect money.
 */
export type ModularResearchCycle = 'monthly' | 'annual';

export type ModularResearchCatalog = {
  catalogId: string;
  version: number;
  state: 'research_only';
  currency: 'EGP';
  industry: string;
  monthlyPerAppMinor: Readonly<Record<string, number>>;
  includedBranches: number;
  extraBranchMonthlyMinor: number;
  maxBranches: number;
  annualMonthsCharged: number;
};

export type ModularSelection = {
  industry: string;
  apps: readonly string[];
  branches: number;
  cycle: ModularResearchCycle;
};

export type ModularResearchRules = {
  requiredApps: readonly string[];
  eligibleApps: readonly string[];
  dependencies: Readonly<Record<string, readonly string[]>>;
  labels: Readonly<Record<string, string>>;
};

export type ModularQuoteLine = {
  code: string;
  label: string;
  quantity: number;
  unitMonthlyMinor: number;
  totalMonthlyMinor: number;
};

export type ModularResearchQuote = {
  kind: 'internal_research_only';
  canCheckout: false;
  canActivate: false;
  approvedForSale: false;
  catalogId: string;
  catalogVersion: number;
  currency: 'EGP';
  cycle: ModularResearchCycle;
  industry: string;
  apps: string[];
  branches: number;
  lines: ModularQuoteLine[];
  totalMonthlyMinor: number;
  totalPeriodMinor: number;
  chargedMonths: number;
  excludedFromEstimate: readonly ['taxes', 'gateway_fees', 'usage_based_services'];
};

export class ModularQuoteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ModularQuoteError';
  }
}

const APP_CODE = /^[a-z][a-z0-9-]{0,63}$/;
const CATALOG_ID = /^[a-z][a-z0-9-]{0,80}$/;

function positiveMoney(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new ModularQuoteError('CATALOG_INVALID', name + ' must be a non-negative integer in minor currency units');
  }
  return value;
}

function safeTotal(a: number, b: number): number {
  const x = a + b;
  if (!Number.isSafeInteger(x)) throw new ModularQuoteError('AMOUNT_OVERFLOW', 'Quote total exceeds safe integer limits');
  return x;
}

function safeMultiply(value: number, count: number): number {
  const x = value * count;
  if (!Number.isSafeInteger(x)) throw new ModularQuoteError('AMOUNT_OVERFLOW', 'Quote amount exceeds safe integer limits');
  return x;
}

/** Validates a complete catalog at the trust boundary. Never fall back to zero for unknown apps. */
function assertResearchCatalog(catalog: ModularResearchCatalog, rules: ModularResearchRules): void {
  if (catalog.state !== 'research_only' || catalog.currency !== 'EGP' ||
      typeof catalog.catalogId !== 'string' || !CATALOG_ID.test(catalog.catalogId) ||
      !Number.isSafeInteger(catalog.version) || catalog.version < 1 ||
      typeof catalog.industry !== 'string' || !catalog.industry ||
      !Number.isSafeInteger(catalog.includedBranches) || catalog.includedBranches < 1 ||
      !Number.isSafeInteger(catalog.maxBranches) || catalog.maxBranches < catalog.includedBranches ||
      catalog.maxBranches > 100000 ||
      !Number.isSafeInteger(catalog.annualMonthsCharged) ||
      catalog.annualMonthsCharged < 1 || catalog.annualMonthsCharged > 12) {
    throw new ModularQuoteError('CATALOG_INVALID', 'Research catalog has invalid metadata');
  }
  positiveMoney(catalog.extraBranchMonthlyMinor, 'extraBranchMonthlyMinor', true);
  if (!catalog.monthlyPerAppMinor || typeof catalog.monthlyPerAppMinor !== 'object' ||
      Array.isArray(catalog.monthlyPerAppMinor) || !Array.isArray(rules.requiredApps) ||
      !Array.isArray(rules.eligibleApps)) {
    throw new ModularQuoteError('CATALOG_INVALID', 'Invalid research app catalog');
  }
  const eligible = new Set(rules.eligibleApps);
  if (eligible.size !== rules.eligibleApps.length ||
      rules.requiredApps.some((c) => !eligible.has(c)) ||
      rules.eligibleApps.some((c) => !APP_CODE.test(c))) {
    throw new ModularQuoteError('CATALOG_INVALID', 'Invalid research eligibility rules');
  }
  for (const [code, amount] of Object.entries(catalog.monthlyPerAppMinor)) {
    if (!eligible.has(code) || !rules.labels[code]) {
      throw new ModularQuoteError('CATALOG_INVALID', 'Unrecognized catalog app: ' + code);
    }
    positiveMoney(amount, 'app price: ' + code);
  }
  for (const code of eligible) {
    if (!Object.prototype.hasOwnProperty.call(catalog.monthlyPerAppMinor, code)) {
      throw new ModularQuoteError('CATALOG_INVALID', 'Missing catalog app price: ' + code);
    }
  }
}

/**
 * Deterministic itemized PREVIEW. The catalog and app policy are server-selected.
 * User input NEVER includes amount, tenant identity, or a paid status.
 */
export function calculateModularResearchQuote(
  input: ModularSelection,
  catalog: ModularResearchCatalog,
  rules: ModularResearchRules,
): ModularResearchQuote {
  assertResearchCatalog(catalog, rules);
  if (input.industry !== catalog.industry) {
    throw new ModularQuoteError('INDUSTRY_UNSUPPORTED', 'Industry not supported by this research catalog');
  }
  if (input.cycle !== 'monthly' && input.cycle !== 'annual') {
    throw new ModularQuoteError('CYCLE_INVALID', 'Unsupported cycle');
  }
  if (!Number.isSafeInteger(input.branches) ||
      input.branches < 1 || input.branches > catalog.maxBranches) {
    throw new ModularQuoteError('BRANCH_COUNT_INVALID', 'Branch count outside research scenario limit');
  }
  if (!Array.isArray(input.apps) ||
      input.apps.length > rules.eligibleApps.length ||
      input.apps.some((c) => typeof c !== 'string' || !APP_CODE.test(c))) {
    throw new ModularQuoteError('APPS_INVALID', 'Invalid selected apps');
  }
  const selected = new Set(input.apps);
  if (selected.size !== input.apps.length) {
    throw new ModularQuoteError('APPS_DUPLICATED', 'Repeated app selection');
  }
  for (const code of rules.requiredApps) {
    if (!selected.has(code)) throw new ModularQuoteError('REQUIRED_APP_MISSING', 'Required app missing: ' + code);
  }
  const eligible = new Set(rules.eligibleApps);
  for (const code of selected) {
    if (!eligible.has(code)) throw new ModularQuoteError('APP_NOT_PRICEABLE', 'App is not eligible for this research catalog: ' + code);
    for (const dep of rules.dependencies[code] ?? []) {
      if (!selected.has(dep)) {
        throw new ModularQuoteError('MISSING_DEPENDENCY', 'Missing required app: ' + dep);
      }
    }
  }
  const lines: ModularQuoteLine[] = [...selected].sort().map((code) => ({
    code, label: rules.labels[code]!,
    quantity: 1,
    unitMonthlyMinor: catalog.monthlyPerAppMinor[code]!,
    totalMonthlyMinor: catalog.monthlyPerAppMinor[code]!,
  }));
  const extraBranchCount = Math.max(0, input.branches - catalog.includedBranches);
  if (extraBranchCount) {
    lines.push({
      code: 'extra-branch', label: 'Additional branch (research hypothesis)',
      quantity: extraBranchCount,
      unitMonthlyMinor: catalog.extraBranchMonthlyMinor,
      totalMonthlyMinor: safeMultiply(catalog.extraBranchMonthlyMinor, extraBranchCount),
    });
  }
  const totalMonthlyMinor = lines.reduce((sum, line) => safeTotal(sum, line.totalMonthlyMinor), 0);
  const chargedMonths = input.cycle === 'annual' ? catalog.annualMonthsCharged : 1;
  return {
    kind: 'internal_research_only',
    canCheckout: false,
    canActivate: false,
    approvedForSale: false,
    catalogId: catalog.catalogId,
    catalogVersion: catalog.version,
    currency: catalog.currency,
    cycle: input.cycle,
    industry: input.industry,
    apps: [...selected].sort(),
    branches: input.branches,
    lines,
    totalMonthlyMinor,
    totalPeriodMinor: safeMultiply(totalMonthlyMinor, chargedMonths),
    chargedMonths,
    excludedFromEstimate: ['taxes', 'gateway_fees', 'usage_based_services'],
  };
}

export type ModularResearchComparison = {
  kind: 'internal_research_comparison';
  canChangeSubscription: false;
  prorationCalculated: false;
  from: ModularResearchQuote;
  to: ModularResearchQuote;
  monthlyDifferenceMinor: number;
  periodDifferenceMinor: number;
  addedApps: string[];
  removedApps: string[];
};

/** This is a BEFORE/AFTER study, not an upgrade payment or refund calculation. */
export function compareModularResearchQuotes(
  before: ModularResearchQuote,
  after: ModularResearchQuote,
): ModularResearchComparison {
  if (before.kind !== 'internal_research_only' || after.kind !== 'internal_research_only' ||
      before.catalogId !== after.catalogId || before.catalogVersion !== after.catalogVersion ||
      before.currency !== after.currency || before.industry !== after.industry ||
      before.cycle !== after.cycle || before.canCheckout !== false ||
      after.canCheckout !== false || before.approvedForSale !== false ||
      after.approvedForSale !== false) {
    throw new ModularQuoteError('COMPARISON_INCOMPATIBLE', 'Cannot compare different research catalogs or cycles');
  }
  const old = new Set(before.apps);
  const next = new Set(after.apps);
  return {
    kind: 'internal_research_comparison',
    canChangeSubscription: false,
    prorationCalculated: false,
    from: before, to: after,
    monthlyDifferenceMinor: after.totalMonthlyMinor - before.totalMonthlyMinor,
    periodDifferenceMinor: after.totalPeriodMinor - before.totalPeriodMinor,
    addedApps: [...next].filter((c) => !old.has(c)).sort(),
    removedApps: [...old].filter((c) => !next.has(c)).sort(),
  };
}

/** Formatting is presentation-only, never the calculation primitive. */
export function minorToEgp(minor: number): number {
  if (!Number.isSafeInteger(minor)) throw new ModularQuoteError('AMOUNT_INVALID', 'Invalid minor amount');
  return minor / 100;
}
