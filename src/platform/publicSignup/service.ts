import 'server-only';
import crypto from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import { findIndustryPack } from '@/packs';
import { onboardBusiness, defaultOnboardingDeps } from '@/platform/onboarding/wizard/coordinator';
import type { OnboardingRequest } from '@/platform/onboarding/wizard/types';
import { TenantOnboardingError } from '@/platform/onboarding/errors';
import { PublicSignupAppSelectionError, resolvePublicSignupAppSelection } from './appSelection';
import {
  PUBLIC_SIGNUP_INDUSTRIES,
  PUBLIC_SIGNUP_NEEDS,
  type PublicSignupInput,
  type PublicSignupIndustry,
  type PublicSignupNeed,
  type PublicSignupResult,
  type PublicSignupStartMode,
} from './types';

const MAX_SIGNUPS_PER_IP_24H = 5;
const MIN_PASSWORD_LENGTH = 10;

export class PublicSignupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'PublicSignupError';
  }
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function normalizeEgyptPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (/^01\d{9}$/.test(digits)) return `20${digits.slice(1)}`;
  if (/^201\d{9}$/.test(digits)) return digits;
  throw new PublicSignupError('PHONE_INVALID', 'اكتب رقم موبايل مصري صحيح.', 400);
}

function normalizeEmail(value: unknown): string | null {
  const email = cleanText(value, 254).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PublicSignupError('EMAIL_INVALID', 'البريد الإلكتروني غير صحيح.', 400);
  }
  return email;
}

function normalizeIndustry(value: unknown): PublicSignupIndustry {
  const industry = cleanText(value, 64).toLowerCase() as PublicSignupIndustry;
  if (!PUBLIC_SIGNUP_INDUSTRIES.includes(industry)) {
    throw new PublicSignupError('INDUSTRY_INVALID', 'اختر نوع نشاط متاح.', 400);
  }
  return industry;
}

function normalizeNeeds(value: unknown): PublicSignupNeed[] {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(
    raw
      .map((x) => cleanText(x, 32) as PublicSignupNeed)
      .filter((x) => PUBLIC_SIGNUP_NEEDS.includes(x)),
  )];
}

function normalizeStartMode(value: unknown, industry: PublicSignupIndustry): PublicSignupStartMode {
  const mode = cleanText(value, 20) as PublicSignupStartMode;
  if (mode !== 'real' && mode !== 'demo') {
    throw new PublicSignupError('START_MODE_INVALID', 'اختر طريقة البداية.', 400);
  }
  if (industry !== 'salon' && mode === 'demo') {
    return 'real';
  }
  return mode;
}

export function parsePublicSignupInput(body: unknown): PublicSignupInput {
  if (!body || typeof body !== 'object') {
    throw new PublicSignupError('BODY_INVALID', 'بيانات التسجيل غير صحيحة.', 400);
  }
  const x = body as Record<string, unknown>;
  const industry = normalizeIndustry(x.industry);
  const contactName = cleanText(x.contactName, 100);
  const businessName = cleanText(x.businessName, 200);
  const password = String(x.password ?? '');
  if (contactName.length < 2) {
    throw new PublicSignupError('CONTACT_NAME_INVALID', 'اكتب اسمك.', 400);
  }
  if (businessName.length < 2) {
    throw new PublicSignupError('BUSINESS_NAME_INVALID', 'اكتب اسم النشاط.', 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PublicSignupError(
      'PASSWORD_WEAK',
      `كلمة المرور لازم تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل.`,
      400,
    );
  }
  let selectedApps: string[] | undefined;
  if (x.selectedApps !== undefined) {
    try {
      selectedApps = resolvePublicSignupAppSelection(industry, x.selectedApps).apps;
    } catch (err) {
      if (err instanceof PublicSignupAppSelectionError) {
        throw new PublicSignupError(err.code, err.message, 400);
      }
      throw err;
    }
  }
  return {
    industry,
    needs: normalizeNeeds(x.needs),
    ...(selectedApps === undefined ? {} : { selectedApps }),
    contactName,
    businessName,
    phone: normalizeEgyptPhone(x.phone),
    email: normalizeEmail(x.email),
    password,
    startMode: normalizeStartMode(x.startMode, industry),
  };
}

export function signupIpHash(ip: string | null | undefined): string | null {
  const clean = String(ip ?? '').trim();
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

function identityFrom(input: PublicSignupInput) {
  const digest = crypto
    .createHash('sha256')
    .update(`${input.phone}|${input.businessName}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  return {
    tenantCode: `DRVO_${digest}`,
    branchCode: `DRVO_${digest}_MAIN`,
    ownerLoginName: `u${input.phone}`,
  };
}

function demoSalonServices() {
  return [
    { name: 'Hair Cut', arabicName: 'قص شعر', categoryName: 'خدمات', price: 200, durationMinutes: 30, active: true },
    { name: 'Beard Styling', arabicName: 'تهذيب دقن', categoryName: 'خدمات', price: 100, durationMinutes: 20, active: true },
    { name: 'Hair & Beard', arabicName: 'شعر ودقن', categoryName: 'خدمات', price: 280, durationMinutes: 45, active: true },
    { name: 'Classic Skin Care', arabicName: 'تنظيف بشرة كلاسيك', categoryName: 'خدمات', price: 300, durationMinutes: 45, active: true },
  ];
}

function demoSalonEmployees(branchCode: string) {
  return [
    { name: 'أحمد Demo', job: 'حلاق', primaryBranchCode: branchCode, active: true, acceptsBookings: true },
    { name: 'كريم Demo', job: 'حلاق', primaryBranchCode: branchCode, active: true, acceptsBookings: true },
  ];
}

function appCustomizations(industry: PublicSignupIndustry, needs: PublicSignupNeed[]) {
  const add: string[] = [];
  if (industry === 'salon' && needs.includes('inventory')) {
    add.push('inventory', 'purchasing');
  }
  if (industry === 'supermarket') {
    if (needs.includes('workforce')) add.push('attendance');
    if (needs.includes('payroll')) add.push('payroll');
  }
  return { add: [...new Set(add)], remove: [] as string[] };
}

function buildOnboardingRequest(input: PublicSignupInput): OnboardingRequest {
  const ids = identityFrom(input);
  const custom = input.selectedApps === undefined
    ? appCustomizations(input.industry, input.needs)
    : resolvePublicSignupAppSelection(input.industry, input.selectedApps).customizations;
  const salon = input.industry === 'salon';
  const withDemo = salon && input.startMode === 'demo';

  return {
    business: {
      businessName: input.businessName,
      tenantCode: ids.tenantCode,
      industryPackCode: input.industry,
      timezone: 'Africa/Cairo',
      currency: 'EGP',
      businessPhone: `+${input.phone}`,
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
      receiptFooter: null,
    },
    branches: [
      {
        branchName: 'الفرع الرئيسي',
        branchCode: ids.branchCode,
        shortName: 'الرئيسي',
        address: null,
        phone: `+${input.phone}`,
        timezone: 'Africa/Cairo',
        defaultOpenTime: '11:00',
        defaultCloseTime: '23:00',
      },
    ],
    services: withDemo ? demoSalonServices() : [],
    employees: withDemo ? demoSalonEmployees(ids.branchCode) : [],
    owner: {
      displayName: input.contactName,
      loginName: ids.ownerLoginName,
      password: input.password,
    },
    users: [],
    apps: custom,
    subscription: { planCode: 'starter', status: 'trial' },
    booking: salon
      ? [
          {
            branchCode: ids.branchCode,
            defaultMode: 'nearest',
            slotIntervalMinutes: 15,
            minNoticeMinutes: 30,
            maxBookingDaysAhead: 14,
            defaultServiceDurationMinutes: 30,
            allowSpecificBarber: true,
            allowNearestBarber: true,
          },
        ]
      : [],
    ai: null,
  };
}

async function markFailed(signupId: string, errorCode: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input('signupId', sql.UniqueIdentifier, signupId)
    .input('code', sql.NVarChar(64), errorCode)
    .query(`
      UPDATE dbo.PublicSignupRegistration
      SET Status=N'failed', ErrorCode=@code, UpdatedAt=SYSUTCDATETIME()
      WHERE SignupId=@signupId;
    `);
}

export async function provisionPublicSignup(
  raw: unknown,
  opts: { ip?: string | null } = {},
): Promise<PublicSignupResult> {
  const input = parsePublicSignupInput(raw);
  const ipHash = signupIpHash(opts.ip);
  const ids = identityFrom(input);
  const pool = await getPool();

  if (ipHash) {
    const recent = await pool
      .request()
      .input('ipHash', sql.Char(64), ipHash)
      .query(`
        SELECT COUNT(*) AS n
        FROM dbo.PublicSignupRegistration WITH (NOLOCK)
        WHERE IpHash=@ipHash AND CreatedAt >= DATEADD(HOUR,-24,SYSUTCDATETIME());
      `);
    if (Number(recent.recordset[0]?.n ?? 0) >= MAX_SIGNUPS_PER_IP_24H) {
      throw new PublicSignupError(
        'RATE_LIMITED',
        'وصلت للحد المؤقت لإنشاء الحسابات. جرّب بكرة أو تواصل معانا.',
        429,
      );
    }
  }

  const existing = await pool
    .request()
    .input('phone', sql.NVarChar(32), input.phone)
    .query(`
      SELECT SignupId, Status, TenantId
      FROM dbo.PublicSignupRegistration
      WHERE PhoneNormalized=@phone;
    `);

  let signupId: string;
  const old = existing.recordset[0] as
    | { SignupId: string; Status: string; TenantId: string | null }
    | undefined;

  if (old?.Status === 'provisioned' && old.TenantId) {
    throw new PublicSignupError(
      'PHONE_ALREADY_REGISTERED',
      'الرقم ده عليه حساب DRVO بالفعل. استخدم تسجيل الدخول.',
      409,
    );
  }
  if (old?.Status === 'provisioning') {
    throw new PublicSignupError(
      'SIGNUP_IN_PROGRESS',
      'الحساب بيتجهز بالفعل. استنى لحظات وحاول تسجيل الدخول.',
      409,
    );
  }

  if (old) {
    signupId = String(old.SignupId);
    await pool
      .request()
      .input('signupId', sql.UniqueIdentifier, signupId)
      .input('email', sql.NVarChar(254), input.email)
      .input('contactName', sql.NVarChar(100), input.contactName)
      .input('businessName', sql.NVarChar(200), input.businessName)
      .input('industry', sql.NVarChar(64), input.industry)
      .input('needs', sql.NVarChar(sql.MAX), JSON.stringify(input.needs))
      .input('startMode', sql.NVarChar(20), input.startMode)
      .input('ipHash', sql.Char(64), ipHash)
      .query(`
        UPDATE dbo.PublicSignupRegistration
        SET Email=@email, ContactName=@contactName, BusinessName=@businessName,
            IndustryCode=@industry, NeedsJson=@needs, StartMode=@startMode,
            IpHash=@ipHash, Status=N'provisioning', ErrorCode=NULL, UpdatedAt=SYSUTCDATETIME()
        WHERE SignupId=@signupId;
      `);
  } else {
    const inserted = await pool
      .request()
      .input('phone', sql.NVarChar(32), input.phone)
      .input('email', sql.NVarChar(254), input.email)
      .input('contactName', sql.NVarChar(100), input.contactName)
      .input('businessName', sql.NVarChar(200), input.businessName)
      .input('industry', sql.NVarChar(64), input.industry)
      .input('needs', sql.NVarChar(sql.MAX), JSON.stringify(input.needs))
      .input('startMode', sql.NVarChar(20), input.startMode)
      .input('ipHash', sql.Char(64), ipHash)
      .query(`
        INSERT INTO dbo.PublicSignupRegistration
          (PhoneNormalized,Email,ContactName,BusinessName,IndustryCode,NeedsJson,StartMode,IpHash,Status)
        OUTPUT INSERTED.SignupId
        VALUES
          (@phone,@email,@contactName,@businessName,@industry,@needs,@startMode,@ipHash,N'provisioning');
      `);
    signupId = String(inserted.recordset[0].SignupId);
  }

  try {
    const request = buildOnboardingRequest(input);
    const result = await onboardBusiness(
      request,
      { actorUserId: 0, actorUserName: 'public-self-service' },
      defaultOnboardingDeps(findIndustryPack),
    );
    if (!result.complete) {
      throw new PublicSignupError(
        'SETUP_INCOMPLETE',
        'اتعمل الحساب لكن محتاج مراجعة إعداد. فريق DRVO هيكمل معاك.',
        500,
      );
    }

    await pool
      .request()
      .input('signupId', sql.UniqueIdentifier, signupId)
      .input('tenantId', sql.UniqueIdentifier, result.core.tenantId)
      .query(`
        UPDATE dbo.PublicSignupRegistration
        SET Status=N'provisioned', TenantId=@tenantId, ErrorCode=NULL,
            ProvisionedAt=SYSUTCDATETIME(), UpdatedAt=SYSUTCDATETIME()
        WHERE SignupId=@signupId;
      `);

    return {
      signupId,
      tenantId: result.core.tenantId,
      tenantCode: result.core.tenantCode,
      ownerLoginName: result.core.ownerLoginName,
      branchCode: result.core.branchCode,
      trialEndsAt: result.core.trialEndsAt,
      nextPath: '/operations',
    };
  } catch (err) {
    const code =
      err instanceof PublicSignupError
        ? err.code
        : err instanceof TenantOnboardingError
          ? err.code
          : 'SIGNUP_PROVISION_FAILED';
    await markFailed(signupId, code).catch(() => undefined);
    if (err instanceof PublicSignupError) throw err;
    if (err instanceof TenantOnboardingError) {
      throw new PublicSignupError(
        err.code,
        err.code.includes('CONFLICT')
          ? 'البيانات دي مستخدمة بالفعل. جرّب مرة تانية.'
          : 'تعذر تجهيز الحساب دلوقتي. جرّب مرة تانية.',
        err.status,
      );
    }
    throw new PublicSignupError(
      'SIGNUP_PROVISION_FAILED',
      'تعذر تجهيز الحساب دلوقتي. جرّب مرة تانية.',
      500,
    );
  }
}
