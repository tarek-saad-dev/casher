import type { IndustryPackDefinition } from '@/platform/packs/types';
import {
  AI_DEFAULT_LOCALE,
  DEFAULT_BUSINESS_CURRENCY,
  DEFAULT_BUSINESS_TIMEZONE,
  DEFAULT_SERVICE_CATEGORY,
  DEFAULT_SERVICE_DURATION_MINUTES,
  conversationPackForIndustry,
  defaultBookingFor,
  resolveWizardApps,
  suggestBranchCode,
  suggestTenantCode,
  usesServiceCatalog,
} from './plan';
import type {
  OnboardingAiInput,
  OnboardingBookingInput,
  OnboardingBranchInput,
  OnboardingBusinessInput,
  OnboardingEmployeeInput,
  OnboardingOwnerInput,
  OnboardingRequest,
  OnboardingServiceInput,
  OnboardingUserInput,
} from './types';

/**
 * Wizard UI state (browser memory only — never persisted; holds passwords).
 * Rows reference branches by position so editing a branch code never orphans them.
 */
export type DraftEmployee = Omit<OnboardingEmployeeInput, 'primaryBranchCode'> & { branchIndex: number };
export type DraftUser = Omit<OnboardingUserInput, 'defaultBranchCode'> & { branchIndex: number };
export type DraftBooking = Omit<OnboardingBookingInput, 'branchCode'>;

export type OnboardingDraft = {
  business: OnboardingBusinessInput;
  branches: OnboardingBranchInput[];
  /** Aligned with `branches` by index. */
  booking: DraftBooking[];
  services: OnboardingServiceInput[];
  employees: DraftEmployee[];
  owner: OnboardingOwnerInput;
  users: DraftUser[];
  apps: { add: string[]; remove: string[] };
  subscription: { planCode: string; status: 'trial' | 'active' };
  ai: OnboardingAiInput;
};

function draftBooking(): DraftBooking {
  const defaults: Partial<OnboardingBookingInput> = defaultBookingFor('');
  delete defaults.branchCode;
  return defaults as DraftBooking;
}

export function emptyBranch(tenantCode: string, index: number): OnboardingBranchInput {
  return {
    branchName: '',
    branchCode: suggestBranchCode(tenantCode, index),
    shortName: null,
    address: null,
    phone: null,
    timezone: null,
    defaultOpenTime: null,
    defaultCloseTime: null,
  };
}

export function emptyService(): OnboardingServiceInput {
  return {
    name: '',
    arabicName: null,
    categoryName: DEFAULT_SERVICE_CATEGORY,
    price: 0,
    durationMinutes: DEFAULT_SERVICE_DURATION_MINUTES,
    active: true,
  };
}

export function emptyEmployee(): DraftEmployee {
  return { name: '', job: '', branchIndex: 0, active: true };
}

export function emptyUser(): DraftUser {
  return { displayName: '', loginName: '', password: '', roleKey: '', branchIndex: 0 };
}

export function initialDraft(defaultPlanCode = 'starter'): OnboardingDraft {
  return {
    business: {
      businessName: '',
      tenantCode: '',
      industryPackCode: '',
      timezone: DEFAULT_BUSINESS_TIMEZONE,
      currency: DEFAULT_BUSINESS_CURRENCY,
      businessPhone: null,
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
      receiptFooter: null,
    },
    branches: [emptyBranch('', 0)],
    booking: [draftBooking()],
    services: [],
    employees: [],
    owner: { displayName: '', loginName: '', password: '' },
    users: [],
    apps: { add: [], remove: [] },
    subscription: { planCode: defaultPlanCode, status: 'trial' },
    ai: {
      businessName: '',
      locale: AI_DEFAULT_LOCALE,
      assistantPersona: null,
      websiteUrl: null,
      bookingUrl: null,
      policies: [],
      useSalonConciergePack: false,
    },
  };
}

/** Business name edit; auto codes follow the name until the operator edits them. */
export function setBusinessName(d: OnboardingDraft, name: string): OnboardingDraft {
  const autoCode = !d.business.tenantCode || d.business.tenantCode === suggestTenantCode(d.business.businessName);
  const next = { ...d, business: { ...d.business, businessName: name } };
  const withCode = autoCode ? setTenantCode(next, name.trim() ? suggestTenantCode(name) : '') : next;
  const autoAiName = !d.ai.businessName || d.ai.businessName === d.business.businessName;
  return autoAiName ? { ...withCode, ai: { ...withCode.ai, businessName: name } } : withCode;
}

export function setTenantCode(d: OnboardingDraft, code: string): OnboardingDraft {
  const prev = d.business.tenantCode;
  const nextCode = code.toUpperCase();
  return {
    ...d,
    business: { ...d.business, tenantCode: nextCode },
    branches: d.branches.map((b, i) =>
      !b.branchCode || b.branchCode === suggestBranchCode(prev, i)
        ? { ...b, branchCode: suggestBranchCode(nextCode, i) }
        : b,
    ),
  };
}

/** Changing the industry resets everything that depends on it. */
export function setIndustryPack(d: OnboardingDraft, packCode: string): OnboardingDraft {
  return {
    ...d,
    business: { ...d.business, industryPackCode: packCode },
    apps: { add: [], remove: [] },
    services: usesServiceCatalog(packCode) ? d.services : [],
    ai: { ...d.ai, useSalonConciergePack: false },
  };
}

export function addBranch(d: OnboardingDraft): OnboardingDraft {
  return {
    ...d,
    branches: [...d.branches, emptyBranch(d.business.tenantCode, d.branches.length)],
    booking: [...d.booking, draftBooking()],
  };
}

/** Removes a branch (never the first) and re-points rows that referenced it to the first branch. */
export function removeBranch(d: OnboardingDraft, index: number): OnboardingDraft {
  if (index <= 0 || index >= d.branches.length) return d;
  const remap = (i: number) => (i === index ? 0 : i > index ? i - 1 : i);
  return {
    ...d,
    branches: d.branches.filter((_, i) => i !== index),
    booking: d.booking.filter((_, i) => i !== index),
    employees: d.employees.map((e) => ({ ...e, branchIndex: remap(e.branchIndex) })),
    users: d.users.map((u) => ({ ...u, branchIndex: remap(u.branchIndex) })),
  };
}

/** Toggle a non-required pack app (recommended -> remove list, optional -> add list). */
export function toggleApp(d: OnboardingDraft, pack: IndustryPackDefinition, appCode: string, on: boolean): OnboardingDraft {
  if (pack.required.includes(appCode)) return d;
  const add = new Set(d.apps.add);
  const remove = new Set(d.apps.remove);
  if (pack.recommended.includes(appCode)) {
    if (on) remove.delete(appCode);
    else remove.add(appCode);
  } else if (pack.optional.includes(appCode)) {
    if (on) add.add(appCode);
    else add.delete(appCode);
  } else {
    return d;
  }
  return { ...d, apps: { add: [...add], remove: [...remove] } };
}

const PAYROLL_APPS = ['attendance', 'payroll'];

/** Request sent to the server: only what applies to the chosen industry and apps. */
export function buildOnboardingRequest(
  d: OnboardingDraft,
  pack: IndustryPackDefinition | null,
): { request: OnboardingRequest; apps: string[] | null } {
  const apps = resolveWizardApps(pack, d.apps);
  const installed = new Set(apps ?? []);
  const codeAt = (i: number) => d.branches[i]?.branchCode ?? '';
  const withPayroll = PAYROLL_APPS.some((a) => installed.has(a));
  const packCode = pack?.packCode ?? null;

  const request: OnboardingRequest = {
    business: d.business,
    branches: d.branches,
    services: usesServiceCatalog(packCode) ? d.services : [],
    employees: d.employees.map(({ branchIndex, ...e }) => ({
      name: e.name,
      job: e.job,
      active: e.active,
      primaryBranchCode: codeAt(branchIndex),
      ...(installed.has('booking') && e.acceptsBookings !== undefined ? { acceptsBookings: e.acceptsBookings } : {}),
      ...(withPayroll && e.employmentType
        ? { employmentType: e.employmentType, payrollMethod: e.payrollMethod ?? null, payRate: e.payRate ?? null }
        : {}),
    })),
    owner: d.owner,
    users: d.users.map(({ branchIndex, ...u }) => ({ ...u, defaultBranchCode: codeAt(branchIndex) })),
    apps: d.apps,
    subscription: d.subscription,
    booking: installed.has('booking')
      ? d.branches.map((b, i) => ({ ...(d.booking[i] ?? draftBooking()), branchCode: b.branchCode }))
      : [],
    ai: installed.has('ai-receptionist')
      ? {
          ...d.ai,
          useSalonConciergePack: d.ai.useSalonConciergePack && conversationPackForIndustry(packCode) != null,
        }
      : null,
  };
  return { request, apps };
}
