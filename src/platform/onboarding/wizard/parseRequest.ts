import { TenantOnboardingError } from '../errors';
import { rejectSystemControlledFields } from '../validation';
import type {
  OnboardingAiInput,
  OnboardingBookingInput,
  OnboardingBranchInput,
  OnboardingEmployeeInput,
  OnboardingRequest,
  OnboardingServiceInput,
  OnboardingUserInput,
} from './types';

/** Fields the browser never controls on any onboarding object. */
export const ONBOARDING_FORBIDDEN_FIELDS = [
  'tenantId',
  'TenantId',
  'locationId',
  'membershipId',
  'legacyBranchId',
  'legacyUserId',
  'branchId',
  'userId',
  'empId',
  'entitlements',
  'origin',
  'trialEndsAt',
  'ownerRole',
  'ownerUserLevel',
  'userLevel',
  'isActive',
  'lifecycleStatus',
  'publicBookingEnabled',
  'bookingEnabled',
  'enabled',
];

type Obj = Record<string, unknown>;

function invalid(message: string): never {
  throw new TenantOnboardingError('ONBOARDING_PLAN_INVALID', message);
}

function obj(value: unknown, field: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} must be an object`);
  rejectSystemControlledFields(value as Obj, ONBOARDING_FORBIDDEN_FIELDS);
  return value as Obj;
}

function list(value: unknown, field: string, max: number): Obj[] {
  if (value == null) return [];
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  if (value.length > max) invalid(`${field} has more than ${max} rows`);
  return value.map((v, i) => obj(v, `${field}[${i}]`));
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const optStr = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const num = (v: unknown): number => (v === '' || v == null ? Number.NaN : Number(v));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function strings(value: unknown, field: string, max: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) invalid(`${field} must be an array of strings`);
  if (value.length > max) invalid(`${field} has more than ${max} entries`);
  return value as string[];
}

export function parseOnboardingRequest(body: unknown): OnboardingRequest {
  const root = obj(body, 'request');
  const business = obj(root.business, 'business');
  const owner = obj(root.owner, 'owner');
  const apps = root.apps == null ? {} : obj(root.apps, 'apps');
  const subscription = root.subscription == null ? {} : obj(root.subscription, 'subscription');
  const status = str(subscription.status || 'trial');

  const branches: OnboardingBranchInput[] = list(root.branches, 'branches', 50).map((b) => ({
    branchName: str(b.branchName),
    branchCode: str(b.branchCode).trim().toUpperCase(),
    shortName: optStr(b.shortName),
    address: optStr(b.address),
    phone: optStr(b.phone),
    timezone: optStr(b.timezone),
    defaultOpenTime: optStr(b.defaultOpenTime),
    defaultCloseTime: optStr(b.defaultCloseTime),
  }));
  const services: OnboardingServiceInput[] = list(root.services, 'services', 500).map((s) => ({
    name: str(s.name),
    arabicName: optStr(s.arabicName),
    categoryName: optStr(s.categoryName),
    price: num(s.price),
    durationMinutes: num(s.durationMinutes),
    active: bool(s.active, true),
  }));
  const employees: OnboardingEmployeeInput[] = list(root.employees, 'employees', 500).map((e) => ({
    name: str(e.name),
    job: str(e.job),
    primaryBranchCode: str(e.primaryBranchCode).trim().toUpperCase(),
    active: bool(e.active, true),
    acceptsBookings: typeof e.acceptsBookings === 'boolean' ? e.acceptsBookings : undefined,
    employmentType: optStr(e.employmentType),
    payrollMethod: optStr(e.payrollMethod),
    payRate: e.payRate == null || e.payRate === '' ? null : num(e.payRate),
  }));
  const users: OnboardingUserInput[] = list(root.users, 'users', 200).map((u) => ({
    displayName: str(u.displayName),
    loginName: str(u.loginName),
    password: str(u.password),
    roleKey: str(u.roleKey),
    defaultBranchCode: str(u.defaultBranchCode).trim().toUpperCase(),
  }));
  const booking: OnboardingBookingInput[] = list(root.booking, 'booking', 50).map((s) => ({
    branchCode: str(s.branchCode).trim().toUpperCase(),
    defaultMode: str(s.defaultMode),
    slotIntervalMinutes: num(s.slotIntervalMinutes),
    minNoticeMinutes: num(s.minNoticeMinutes),
    maxBookingDaysAhead: num(s.maxBookingDaysAhead),
    defaultServiceDurationMinutes: num(s.defaultServiceDurationMinutes),
    allowSpecificBarber: bool(s.allowSpecificBarber, true),
    allowNearestBarber: bool(s.allowNearestBarber, true),
  }));
  let ai: OnboardingAiInput | null = null;
  if (root.ai != null) {
    const a = obj(root.ai, 'ai');
    ai = {
      businessName: str(a.businessName),
      locale: str(a.locale),
      assistantPersona: optStr(a.assistantPersona),
      websiteUrl: optStr(a.websiteUrl),
      bookingUrl: optStr(a.bookingUrl),
      policies: strings(a.policies, 'ai.policies', 30),
      useSalonConciergePack: bool(a.useSalonConciergePack, false),
    };
  }

  return {
    business: {
      businessName: str(business.businessName),
      tenantCode: str(business.tenantCode),
      industryPackCode: str(business.industryPackCode).trim().toLowerCase(),
      timezone: str(business.timezone),
      currency: str(business.currency).trim().toUpperCase(),
      businessPhone: optStr(business.businessPhone),
      logoUrl: optStr(business.logoUrl),
      primaryColor: optStr(business.primaryColor),
      accentColor: optStr(business.accentColor),
      receiptFooter: optStr(business.receiptFooter),
    },
    branches,
    services,
    employees,
    owner: {
      displayName: str(owner.displayName),
      loginName: str(owner.loginName),
      password: str(owner.password),
    },
    users,
    apps: { add: strings(apps.add, 'apps.add', 30), remove: strings(apps.remove, 'apps.remove', 30) },
    subscription: {
      planCode: str(subscription.planCode || 'starter'),
      status: status === 'active' ? 'active' : status === 'trial' ? 'trial' : invalid('subscription.status must be trial or active'),
    },
    booking,
    ai,
  };
}
