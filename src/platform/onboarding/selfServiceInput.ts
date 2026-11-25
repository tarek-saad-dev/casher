import { JobType } from '@/lib/types';
import type { OnboardingEmployeeInput, OnboardingServiceInput } from './wizard/types';

export class SetupInputError extends Error {}
const invalid = (message: string): never => { throw new SetupInputError(message); };
const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('بيانات غير صحيحة.');
  return raw as Record<string, unknown>;
};
function field(raw: unknown, max: number, label: string, required = true): string {
  if (typeof raw !== 'string' || raw.trim().length > max || (required && !raw.trim())) return invalid(label);
  return raw.trim();
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SETUP_JOBS = [JobType.BARBER, JobType.ASSISTANT, JobType.SKIN_CARE, JobType.HAIR_STYLIST, JobType.RECEPTIONIST, JobType.MANAGER, JobType.OTHER] as const;
export type SetupAction =
  | { action: 'branch'; address: string; phone: string; defaultOpenTime: string; defaultCloseTime: string }
  | { action: 'service'; service: OnboardingServiceInput }
  | { action: 'employee'; employee: Omit<OnboardingEmployeeInput, 'primaryBranchCode'> };

/** Never accept tenant, branch, employee or service IDs from the browser. */
export function parseSetupAction(raw: unknown): SetupAction {
  const data = object(raw);
  const keys = (allowed: string[]) => {
    if (Object.keys(data).some((key) => !allowed.includes(key))) invalid('بيانات إضافية غير مسموح بها.');
  };
  switch (data.action) {
    case 'branch': {
      keys(['action', 'address', 'phone', 'defaultOpenTime', 'defaultCloseTime']);
      const address = field(data.address, 250, 'اكتب عنوان الفرع.');
      const phone = field(data.phone, 40, 'اكتب رقم التواصل.');
      const digits = phone.replace(/\D/g, '');
      if (!/^(01\d{9}|201\d{9})$/.test(digits)) invalid('اكتب رقم موبايل مصري صحيح.');
      const defaultOpenTime = field(data.defaultOpenTime, 5, 'حدد وقت الفتح.');
      const defaultCloseTime = field(data.defaultCloseTime, 5, 'حدد وقت القفل.');
      if (!TIME.test(defaultOpenTime) || !TIME.test(defaultCloseTime) || defaultOpenTime === defaultCloseTime) invalid('راجع ساعات العمل.');
      return { action: 'branch', address, phone, defaultOpenTime, defaultCloseTime };
    }
    case 'service': {
      keys(['action', 'name', 'price', 'durationMinutes']);
      const name = field(data.name, 200, 'اكتب اسم الخدمة.');
      const price = data.price;
      const durationMinutes = data.durationMinutes;
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 1000000 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) return invalid('اكتب سعر صحيح أكبر من صفر (حتى منزلتين عشريتين).');
      if (typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 600) return invalid('مدة الخدمة من 5 إلى 600 دقيقة.');
      return { action: 'service', service: { name, arabicName: name, price, durationMinutes, active: true } };
    }
    case 'employee': {
      keys(['action', 'name', 'job']);
      const name = field(data.name, 200, 'اكتب اسم الموظف.');
      const job = SETUP_JOBS.find((item) => item === data.job);
      if (!job) return invalid('اختر وظيفة متاحة.');
      return { action: 'employee', employee: { name, job, active: true } };
    }
    default: return invalid('خطوة غير متاحة.');
  }
}
