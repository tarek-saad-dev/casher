/**
 * DRVOERP V1 commercial pricing catalog.
 *
 * Product architecture rule:
 * - SaaS plans control commercial capacity (branches/users/trial), not which apps a tenant may use.
 * - Industry packs + tenant app composition remain the source of truth for installed apps.
 * - Billing collection is operator-managed in V1; these prices are the commercial offer shown to operators.
 */

export const DRVO_PRICING_CURRENCY = 'EGP' as const;
export const DRVO_PRICING_EFFECTIVE_FROM = '2026-10-11' as const;
export const DRVO_ANNUAL_FREE_MONTHS = 2 as const;

export type PublicPlanCode = 'starter' | 'growth' | 'pro';

export type PlanPricing = {
  planCode: PublicPlanCode;
  nameAr: string;
  monthlyPrice: number;
  annualPrice: number;
  audience: string;
  positioning: string;
  recommended?: boolean;
};

export const DRVO_PLAN_PRICING: readonly PlanPricing[] = [
  {
    planCode: 'starter',
    nameAr: 'Starter',
    monthlyPrice: 499,
    annualPrice: 4_990,
    audience: 'صالون بفرع واحد وفريق صغير',
    positioning: 'ابدأ التشغيل والحجز والكاشير على نظام واحد.',
  },
  {
    planCode: 'growth',
    nameAr: 'Growth',
    monthlyPrice: 899,
    annualPrice: 8_990,
    audience: 'الصالونات النامية أو متعددة الفروع',
    positioning: 'المساحة المناسبة لمعظم الصالونات التي لديها فريق وتشغيل يومي أكبر.',
    recommended: true,
  },
  {
    planCode: 'pro',
    nameAr: 'Pro',
    monthlyPrice: 1_499,
    annualPrice: 14_990,
    audience: 'المجموعات الكبيرة والتشغيل متعدد الفروع',
    positioning: 'سعة أكبر للإدارة المركزية والتوسع بدون تغيير النظام.',
  },
] as const;

export type CommercialAddOn = {
  code: string;
  nameAr: string;
  billing: 'one_time' | 'monthly' | 'quote';
  price: number | null;
  availability: 'available' | 'coming_soon';
  description: string;
};

export const DRVO_COMMERCIAL_ADDONS: readonly CommercialAddOn[] = [
  {
    code: 'guided-onboarding',
    nameAr: 'إعداد وتشغيل موجه',
    billing: 'one_time',
    price: 1_500,
    availability: 'available',
    description: 'إدخال البيانات الأساسية، مراجعة الإعدادات، وتسليم الحساب جاهزاً لأول تشغيل.',
  },
  {
    code: 'data-migration',
    nameAr: 'نقل بيانات من نظام سابق',
    billing: 'quote',
    price: null,
    availability: 'available',
    description: 'سعر مخصص حسب حجم ونظافة البيانات المطلوبة للنقل.',
  },
  {
    code: 'whatsapp-ai',
    nameAr: 'WhatsApp + AI Receptionist',
    billing: 'quote',
    price: null,
    availability: 'coming_soon',
    description: 'لا يباع لعميل جديد حتى يصبح ربط قناة WhatsApp مستقلة لكل منشأة جاهزاً تجارياً.',
  },
] as const;

export function getPlanPricing(planCode: string | null | undefined): PlanPricing | null {
  return DRVO_PLAN_PRICING.find((p) => p.planCode === planCode) ?? null;
}

export function monthlyEquivalentFromAnnual(plan: PlanPricing): number {
  return Math.round((plan.annualPrice / 12) * 100) / 100;
}

export function annualSavings(plan: PlanPricing): number {
  return plan.monthlyPrice * 12 - plan.annualPrice;
}

export function formatEgp(amount: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: DRVO_PRICING_CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}
