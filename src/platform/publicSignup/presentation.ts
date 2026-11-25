import type { PublicSignupIndustry, PublicSignupStartMode } from './types';

export const SIGNUP_STEPS = ['النشاط', 'التطبيقات', 'البيانات', 'الحساب', 'المراجعة'] as const;
export type SignupDraft = {
  industry: PublicSignupIndustry | null;
  selectedApps: string[];
  contactName: string;
  businessName: string;
  phone: string;
  email: string;
  password: string;
  confirmation: string;
  startMode: PublicSignupStartMode;
};

/** Match the current server contract, without making any claim of phone ownership. */
export function localSignupPhone(value: string): string | null {
  const ascii = value.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
  if (!/^[+\d\s().-]+$/.test(ascii)) return null;
  const digits = ascii.replace(/\D/g, '');
  const local = /^201\d{9}$/.test(digits) ? '0' + digits.slice(2)
    : /^00201\d{9}$/.test(digits) ? '0' + digits.slice(4) : digits;
  return /^01\d{9}$/.test(local) ? local : null;
}

export function signupStepError(step: number, draft: SignupDraft, selectionError: string | null): string | null {
  if (step === 0) return draft.industry ? null : 'اختر نوع نشاطك.';
  if (step === 1) return selectionError || (draft.selectedApps.length ? null : 'اختر التطبيقات.');
  if (step === 2) {
    if (draft.contactName.trim().length < 2 || draft.contactName.trim().length > 100) return 'اكتب اسمك (من حرفين إلى 100 حرف).';
    if (draft.businessName.trim().length < 2 || draft.businessName.trim().length > 200) return 'اكتب اسم النشاط (من حرفين إلى 200 حرف).';
    if (!localSignupPhone(draft.phone)) return 'اكتب رقم موبايل مصري صحيح.';
    if (draft.email.trim() && (draft.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))) return 'راجع البريد الإلكتروني.';
    return null;
  }
  if (step === 3) {
    if (draft.password.length < 10 || draft.password.length > 128 || draft.password !== draft.password.trim()) return 'اكتب كلمة مرور من 10 إلى 128 حرفًا بدون مسافات في البداية أو النهاية.';
    if (draft.confirmation !== draft.password) return 'كلمتا المرور غير متطابقتين.';
    return null;
  }
  if (step === 4) return [0, 1, 2, 3].map(n => signupStepError(n, draft, selectionError)).find(Boolean) ?? null;
  return 'خطوة غير صالحة.';
}
