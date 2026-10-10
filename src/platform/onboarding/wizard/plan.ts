import { JobType } from '@/lib/types';
import {
  BOOKING_SETTINGS_DEFAULTS,
  bookingSettingsValidationError,
} from '@/lib/booking/bookingSettingsValidation';
import {
  EMPLOYMENT_TYPES,
  PAYROLL_METHODS,
  isFreelanceMonthlyBlocked,
  type EmploymentType,
  type PayrollMethod,
} from '@/lib/hr/employee-hr-model';
import { resolveTenantComposition } from '@/platform/apps/compositionResolver';
import { TenantAppError } from '@/platform/apps/errors';
import type { SaaSPlanRecord } from '@/platform/commercial/types';
import type { IndustryPackDefinition } from '@/platform/packs/types';
import { TenantOnboardingError } from '../errors';
import { assertValidTenantCode } from '../validation';
import type {
  OnboardingBookingInput,
  OnboardingIssue,
  OnboardingRequest,
  WizardStepKey,
} from './types';
import { WIZARD_STEPS } from './types';

/** Pure onboarding wizard rules shared by the wizard UI, preflight and the coordinator. */

export const DEFAULT_BUSINESS_TIMEZONE = 'Africa/Cairo';
export const DEFAULT_BUSINESS_CURRENCY = 'EGP';
export const DEFAULT_SERVICE_DURATION_MINUTES = 30;
export const DEFAULT_SERVICE_CATEGORY = 'خدمات';
export const MIN_PASSWORD_LENGTH = 8;
export const AI_DEFAULT_LOCALE = 'ar-EG';
export const SALON_CONCIERGE_PACK_CODE = 'salon-concierge-v1';

const BRANCH_CODE_MAX = 30;
const BRANCH_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const LOGIN_RE = /^[A-Za-z0-9._-]{3,50}$/;
const MAX_SERVICE_DURATION = 600;

/** Packs whose catalog is quick-set as services (salon-style service businesses). */
const SERVICE_CATALOG_PACKS = new Set(['salon']);

export function usesServiceCatalog(packCode: string | null | undefined): boolean {
  return SERVICE_CATALOG_PACKS.has(String(packCode ?? ''));
}

/** Conversation pack an industry may opt into; null when the industry has none. */
export function conversationPackForIndustry(packCode: string | null | undefined): string | null {
  return packCode === 'salon' ? SALON_CONCIERGE_PACK_CODE : null;
}

export const JOB_OPTIONS: readonly string[] = Object.values(JobType);

/** Jobs public booking lists as bookable staff (see publicBookingBarbers). */
const BOOKABLE_JOBS = new Set<string>([JobType.BARBER, JobType.ASSISTANT]);

export function defaultAcceptsBookings(job: string): boolean {
  return BOOKABLE_JOBS.has(job);
}

/**
 * Business labels for additional users, mapped onto the existing role catalog (TblRoles) and
 * legacy UserLevel. The owner is always the tenant `admin` role and is not selectable here.
 */
export const ONBOARDING_USER_ROLES = [
  { roleKey: 'manager', userLevel: 'user', label: 'مدير تشغيل', hint: 'تشغيل ومراجعة' },
  { roleKey: 'receptionist', userLevel: 'user', label: 'استقبال', hint: 'حجوزات وعملاء وطابور' },
  { roleKey: 'cashier', userLevel: 'user', label: 'كاشير', hint: 'نقطة البيع والخزنة اليومية' },
] as const;

export function onboardingRoleFor(roleKey: string) {
  return ONBOARDING_USER_ROLES.find((r) => r.roleKey === roleKey) ?? null;
}

const ARABIC_TO_LATIN: Record<string, string> = {
  ا: 'A', أ: 'A', إ: 'E', آ: 'A', ب: 'B', ت: 'T', ث: 'TH', ج: 'G', ح: 'H', خ: 'KH',
  د: 'D', ذ: 'Z', ر: 'R', ز: 'Z', س: 'S', ش: 'SH', ص: 'S', ض: 'D', ط: 'T', ظ: 'Z',
  ع: 'A', غ: 'GH', ف: 'F', ق: 'K', ك: 'K', ل: 'L', م: 'M', ن: 'N', ه: 'H', ة: 'A',
  و: 'W', ي: 'Y', ى: 'A', ئ: 'E', ؤ: 'O', ء: '',
};

function toCodeBody(name: string): string {
  const latin = [...name.trim()]
    .map((ch) => ARABIC_TO_LATIN[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return latin
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Uppercase safe tenant code from a business name (Arabic names are transliterated). */
export function suggestTenantCode(businessName: string): string {
  let code = toCodeBody(businessName).slice(0, 40).replace(/_+$/, '');
  if (!/^[A-Z]/.test(code)) code = `BIZ_${code}`.replace(/_+$/, '');
  if (code.length < 3) code = `${code}_BIZ`.replace(/^_/, '');
  try {
    assertValidTenantCode(code);
  } catch (err) {
    if (err instanceof TenantOnboardingError && /reserved/.test(err.message)) code = `${code}_BIZ`;
  }
  return code;
}

export function suggestBranchCode(tenantCode: string, index: number): string {
  const suffix = `_${index + 1}`;
  const base = (tenantCode || 'BRANCH').slice(0, BRANCH_CODE_MAX - suffix.length);
  return `${base}${suffix}`;
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Strong random password (browser and Node: Web Crypto). */
export function generateStrongPassword(length = 12): string {
  const bytes = new Uint32Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length];
  return out;
}

export type PackAppGroups = {
  required: string[];
  recommended: string[];
  optional: string[];
};

/** Only the apps the selected pack lists; never the whole AppRegistry. */
export function packAppGroups(pack: IndustryPackDefinition): PackAppGroups {
  return {
    required: [...pack.required],
    recommended: [...pack.recommended],
    optional: [...pack.optional],
  };
}

/** Installed-app set as the composition resolver will compute it; null when invalid. */
export function resolveWizardApps(
  pack: IndustryPackDefinition | null,
  apps: { add: string[]; remove: string[] },
): string[] | null {
  if (!pack) return null;
  try {
    return [...resolveTenantComposition(pack, apps).apps];
  } catch {
    return null;
  }
}

export function visibleWizardSteps(
  packCode: string | null,
  installedApps: readonly string[] | null,
): WizardStepKey[] {
  const apps = new Set(installedApps ?? []);
  return WIZARD_STEPS.filter((step) => {
    if (step === 'booking') return apps.has('booking');
    if (step === 'ai') return apps.has('messaging') || apps.has('ai-receptionist');
    if (step === 'services') return packCode != null;
    return true;
  });
}

export function defaultBookingFor(branchCode: string): OnboardingBookingInput {
  return { branchCode, ...BOOKING_SETTINGS_DEFAULTS };
}

function blank(v: string | null | undefined): boolean {
  return v == null || !String(v).trim();
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isPathOrHttps(v: string): boolean {
  return v.startsWith('/') || /^https:\/\/[^\s]+$/i.test(v);
}

export type OnboardingValidationContext = {
  pack: IndustryPackDefinition | null;
  /** Selected plan; null when unknown (reported as an error). */
  plan: SaaSPlanRecord | null;
};

/** All issues the operator can fix before pressing Create Business. */
export function validateOnboardingRequest(
  req: OnboardingRequest,
  ctx: OnboardingValidationContext,
): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  const add = (step: WizardStepKey, message: string, field?: string, severity: 'error' | 'attention' = 'error') =>
    issues.push({ step, severity, message, ...(field ? { field } : {}) });

  const b = req.business;
  if (blank(b.businessName)) add('business', 'اسم المنشأة مطلوب', 'businessName');
  try {
    assertValidTenantCode(b.tenantCode ?? '');
  } catch (err) {
    add(
      'business',
      err instanceof TenantOnboardingError && /reserved/.test(err.message)
        ? 'هذا الكود محجوز للنظام'
        : 'كود المنشأة: حروف إنجليزية كبيرة وأرقام و _ ، يبدأ بحرف (3–63)',
      'tenantCode',
    );
  }
  if (!ctx.pack) add('business', 'اختر نوع النشاط', 'industryPackCode');
  if (blank(b.timezone) || !isValidTimezone(b.timezone)) add('business', 'المنطقة الزمنية غير صحيحة', 'timezone');
  if (!CURRENCY_RE.test(b.currency ?? '')) add('business', 'العملة: 3 حروف إنجليزية كبيرة مثل EGP', 'currency');
  if (!blank(b.logoUrl) && !isPathOrHttps(String(b.logoUrl).trim())) {
    add('business', 'رابط الشعار يجب أن يبدأ بـ https:// أو /', 'logoUrl');
  }
  for (const field of ['primaryColor', 'accentColor'] as const) {
    if (!blank(b[field]) && !HEX_COLOR_RE.test(String(b[field]).trim())) {
      add('business', 'اللون يجب أن يكون بصيغة #RRGGBB', field);
    }
  }

  const branchCodes = new Set<string>();
  const branchNames = new Set<string>();
  if (!req.branches.length) add('branches', 'الفرع الأول مطلوب');
  req.branches.forEach((br, i) => {
    const label = `الفرع ${i + 1}`;
    if (blank(br.branchName)) add('branches', `${label}: الاسم مطلوب`, `branches.${i}.branchName`);
    const code = String(br.branchCode ?? '').trim().toUpperCase();
    if (!BRANCH_CODE_RE.test(code)) {
      add('branches', `${label}: كود الفرع حروف إنجليزية وأرقام (2–30)`, `branches.${i}.branchCode`);
    } else if (branchCodes.has(code)) {
      add('branches', `${label}: كود الفرع مكرر`, `branches.${i}.branchCode`);
    }
    branchCodes.add(code);
    const name = String(br.branchName ?? '').trim();
    if (name && branchNames.has(name)) add('branches', `${label}: اسم الفرع مكرر`, `branches.${i}.branchName`);
    branchNames.add(name);
    const open = String(br.defaultOpenTime ?? '').trim();
    const close = String(br.defaultCloseTime ?? '').trim();
    if ((open && !TIME_RE.test(open)) || (close && !TIME_RE.test(close))) {
      add('branches', `${label}: الوقت بصيغة HH:mm`, `branches.${i}.hours`);
    } else if (Boolean(open) !== Boolean(close)) {
      add('branches', `${label}: حدد وقت الفتح والإغلاق معاً`, `branches.${i}.hours`);
    }
    if (!blank(br.timezone) && !isValidTimezone(String(br.timezone))) {
      add('branches', `${label}: المنطقة الزمنية غير صحيحة`, `branches.${i}.timezone`);
    }
  });
  if (ctx.plan?.maxBranches != null && req.branches.length > ctx.plan.maxBranches) {
    add('branches', `الخطة ${ctx.plan.displayName} تسمح بـ ${ctx.plan.maxBranches} فرع فقط`, 'branches');
  }

  const packCode = ctx.pack?.packCode ?? null;
  if (usesServiceCatalog(packCode)) {
    const names = new Set<string>();
    req.services.forEach((s, i) => {
      const label = `الخدمة ${i + 1}`;
      const name = String(s.name ?? '').trim();
      if (!name) add('services', `${label}: الاسم مطلوب`, `services.${i}.name`);
      else if (names.has(name)) add('services', `${label}: اسم الخدمة مكرر`, `services.${i}.name`);
      names.add(name);
      if (!Number.isFinite(s.price) || s.price < 0) add('services', `${label}: السعر يجب أن يكون 0 أو أكثر`, `services.${i}.price`);
      if (!Number.isInteger(s.durationMinutes) || s.durationMinutes < 5 || s.durationMinutes > MAX_SERVICE_DURATION) {
        add('services', `${label}: المدة بين 5 و ${MAX_SERVICE_DURATION} دقيقة`, `services.${i}.durationMinutes`);
      }
    });
  } else if (req.services.length) {
    add('services', 'هذا النشاط لا يدعم إعداد الخدمات أثناء الإنشاء', 'services');
  }

  const empNames = new Set<string>();
  req.employees.forEach((e, i) => {
    const label = `الموظف ${i + 1}`;
    const name = String(e.name ?? '').trim();
    if (!name) add('team', `${label}: الاسم مطلوب`, `employees.${i}.name`);
    else if (empNames.has(name)) add('team', `${label}: الاسم مكرر`, `employees.${i}.name`);
    empNames.add(name);
    if (!JOB_OPTIONS.includes(e.job)) add('team', `${label}: اختر الوظيفة`, `employees.${i}.job`);
    if (!branchCodes.has(String(e.primaryBranchCode ?? '').toUpperCase())) {
      add('team', `${label}: اختر الفرع الأساسي`, `employees.${i}.primaryBranchCode`);
    }
    if (e.employmentType != null || e.payrollMethod != null) {
      if (!EMPLOYMENT_TYPES.includes(e.employmentType as EmploymentType)) {
        add('team', `${label}: نوع التوظيف غير صالح`, `employees.${i}.employmentType`);
      }
      if (!PAYROLL_METHODS.includes(e.payrollMethod as PayrollMethod)) {
        add('team', `${label}: طريقة الحساب غير صالحة`, `employees.${i}.payrollMethod`);
      } else if (isFreelanceMonthlyBlocked(e.employmentType as EmploymentType, e.payrollMethod as PayrollMethod)) {
        add('team', `${label}: الفري لانس يحسب بالساعة أو اليومية فقط`, `employees.${i}.payrollMethod`);
      }
      if (!(Number(e.payRate) > 0)) add('team', `${label}: أدخل قيمة الأجر`, `employees.${i}.payRate`);
    }
  });

  const logins = new Set<string>();
  const o = req.owner;
  if (blank(o.displayName)) add('users', 'اسم المالك مطلوب', 'owner.displayName');
  if (!LOGIN_RE.test(String(o.loginName ?? '').trim())) {
    add('users', 'اسم دخول المالك: حروف إنجليزية وأرقام (3–50)', 'owner.loginName');
  }
  if (String(o.password ?? '').length < MIN_PASSWORD_LENGTH) {
    add('users', `كلمة مرور المالك ${MIN_PASSWORD_LENGTH} أحرف على الأقل`, 'owner.password');
  }
  logins.add(String(o.loginName ?? '').trim().toLowerCase());
  req.users.forEach((u, i) => {
    const label = `المستخدم ${i + 1}`;
    if (blank(u.displayName)) add('users', `${label}: الاسم مطلوب`, `users.${i}.displayName`);
    const login = String(u.loginName ?? '').trim();
    if (!LOGIN_RE.test(login)) add('users', `${label}: اسم الدخول حروف إنجليزية وأرقام (3–50)`, `users.${i}.loginName`);
    else if (logins.has(login.toLowerCase())) add('users', `${label}: اسم الدخول مكرر`, `users.${i}.loginName`);
    logins.add(login.toLowerCase());
    if (String(u.password ?? '').length < MIN_PASSWORD_LENGTH) {
      add('users', `${label}: كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`, `users.${i}.password`);
    }
    if (!onboardingRoleFor(u.roleKey)) add('users', `${label}: اختر الدور`, `users.${i}.roleKey`);
    if (!branchCodes.has(String(u.defaultBranchCode ?? '').toUpperCase())) {
      add('users', `${label}: اختر الفرع الافتراضي`, `users.${i}.defaultBranchCode`);
    }
  });
  if (ctx.plan?.maxUsers != null && 1 + req.users.length > ctx.plan.maxUsers) {
    add('users', `الخطة ${ctx.plan.displayName} تسمح بـ ${ctx.plan.maxUsers} مستخدم فقط (بما فيهم المالك)`, 'users');
  }

  let apps: string[] = [];
  if (ctx.pack) {
    try {
      apps = [...resolveTenantComposition(ctx.pack, req.apps).apps];
    } catch (err) {
      add('apps', err instanceof TenantAppError ? `تعارض في التطبيقات: ${err.message}` : 'اختيار التطبيقات غير صالح', 'apps');
    }
    const outside = [...req.apps.add, ...req.apps.remove].filter(
      (code) => !ctx.pack!.recommended.includes(code) && !ctx.pack!.optional.includes(code),
    );
    if (outside.length) add('apps', `تطبيقات خارج هذا النشاط: ${outside.join(', ')}`, 'apps');
  }

  if (!ctx.plan) add('plan', 'اختر خطة اشتراك متاحة', 'planCode');
  if (req.subscription.status !== 'trial' && req.subscription.status !== 'active') {
    add('plan', 'حالة الاشتراك يجب أن تكون تجريبي أو نشط', 'status');
  }

  const bookingInstalled = apps.includes('booking');
  if (bookingInstalled) {
    req.booking.forEach((s, i) => {
      if (!branchCodes.has(String(s.branchCode ?? '').toUpperCase())) {
        add('booking', `إعدادات حجز لفرع غير موجود: ${s.branchCode}`, `booking.${i}.branchCode`);
      }
      const err = bookingSettingsValidationError(s);
      if (err) add('booking', err, `booking.${i}`);
      else if (!Number.isInteger(s.maxBookingDaysAhead)) {
        add('booking', 'عدد أيام الحجز مقدماً يجب أن يكون رقماً صحيحاً', `booking.${i}`);
      }
      if (
        !Number.isInteger(s.defaultServiceDurationMinutes) ||
        s.defaultServiceDurationMinutes < 5 ||
        s.defaultServiceDurationMinutes > MAX_SERVICE_DURATION
      ) {
        add('booking', `مدة الخدمة الافتراضية بين 5 و ${MAX_SERVICE_DURATION} دقيقة`, `booking.${i}.defaultServiceDurationMinutes`);
      }
      if (!s.allowNearestBarber && !s.allowSpecificBarber) {
        add('booking', 'فعّل اختيار أقرب موظف أو موظف محدد على الأقل', `booking.${i}.allow`);
      }
    });
  } else if (req.booking.length) {
    add('booking', 'إعدادات الحجز تتطلب تثبيت تطبيق الحجز', 'booking');
  }

  const aiInstalled = apps.includes('ai-receptionist');
  if (req.ai) {
    if (!aiInstalled) {
      add('ai', 'ملف الذكاء الاصطناعي يتطلب تثبيت تطبيق موظف الاستقبال الذكي', 'ai');
    } else {
      if (blank(req.ai.businessName)) add('ai', 'اسم المنشأة للمساعد مطلوب', 'ai.businessName');
      if (blank(req.ai.locale) || String(req.ai.locale).length > 16) add('ai', 'اللغة غير صحيحة', 'ai.locale');
      for (const field of ['websiteUrl', 'bookingUrl'] as const) {
        const v = req.ai[field];
        if (!blank(v) && !/^https:\/\/[^\s]+$/i.test(String(v).trim())) {
          add('ai', 'الروابط يجب أن تبدأ بـ https://', `ai.${field}`);
        }
      }
      if (String(req.ai.assistantPersona ?? '').length > 400) add('ai', 'وصف المساعد 400 حرف كحد أقصى', 'ai.assistantPersona');
      if (req.ai.useSalonConciergePack && !conversationPackForIndustry(packCode)) {
        add('ai', 'حزمة المحادثة متاحة لنشاط الصالون فقط', 'ai.useSalonConciergePack');
      }
    }
  }
  if (aiInstalled || apps.includes('messaging')) {
    add('ai', 'واتساب غير متصل بعد — يتم الربط بعد الإنشاء، والمساعد يبقى متوقفاً حتى الربط', undefined, 'attention');
  }

  return issues;
}

export type WizardStepStatus = 'ready' | 'attention' | 'optional';

const OPTIONAL_STEPS = new Set<WizardStepKey>(['services', 'team', 'ai']);

export function wizardStepStatus(
  step: WizardStepKey,
  issues: OnboardingIssue[],
  req: OnboardingRequest,
): WizardStepStatus {
  if (issues.some((i) => i.step === step && i.severity === 'error')) return 'attention';
  if (OPTIONAL_STEPS.has(step)) {
    const empty =
      (step === 'services' && req.services.length === 0) ||
      (step === 'team' && req.employees.length === 0) ||
      (step === 'ai' && !req.ai);
    if (empty) return 'optional';
  }
  if (issues.some((i) => i.step === step)) return 'attention';
  return 'ready';
}

export type OnboardingSummary = {
  branches: number;
  services: number;
  employees: number;
  users: number;
  apps: number;
  planCode: string;
  status: 'trial' | 'active';
};

export function summarizeOnboarding(req: OnboardingRequest, apps: readonly string[] | null): OnboardingSummary {
  return {
    branches: req.branches.length,
    services: req.services.length,
    employees: req.employees.length,
    users: 1 + req.users.length,
    apps: apps?.length ?? 0,
    planCode: req.subscription.planCode,
    status: req.subscription.status,
  };
}

export function hasBlockingIssues(issues: OnboardingIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
