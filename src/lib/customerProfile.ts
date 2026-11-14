/** Optional customer demographic information, shared between POS forms and APIs. */
export type CustomerCategory = 'student' | 'adult';
export type EducationLevel = 'school' | 'college';

export interface CustomerProfileDraft {
  customerCategory: CustomerCategory | null;
  educationLevel: EducationLevel | null;
  institutionName: string;
  occupation: string;
}

export interface CustomerProfileValidation {
  customerCategory: CustomerCategory | null;
  educationLevel: EducationLevel | null;
  institutionName: string | null;
  occupation: string | null;
  errors: Record<string, string>;
}

export function validateCustomerProfile(
  rawCategory: unknown,
  rawLevel: unknown,
  rawInstitution: unknown,
  rawOccupation: unknown,
): CustomerProfileValidation {
  const result: CustomerProfileValidation = {
    customerCategory: null,
    educationLevel: null,
    institutionName: null,
    occupation: null,
    errors: {},
  };
  if (rawCategory === null || rawCategory === undefined || rawCategory === '') {
    // Existing customer records and quick checkouts may leave demographics blank.
    return result;
  }
  if (rawCategory !== 'student' && rawCategory !== 'adult') {
    result.errors.customerCategory = 'نوع العميل غير صالح';
    return result;
  }
  result.customerCategory = rawCategory;
  if (rawCategory === 'student') {
    if (rawLevel !== 'school' && rawLevel !== 'college') {
      result.errors.educationLevel = 'اختار مدرسة أو كلية';
    } else {
      result.educationLevel = rawLevel;
    }
    if (typeof rawInstitution !== 'string' || !rawInstitution.trim()) {
      result.errors.institutionName = 'اكتب اسم المدرسة أو الكلية';
    } else {
      const name = rawInstitution.trim().replace(/\s+/g, ' ');
      if (name.length > 150) result.errors.institutionName = 'الاسم طويل جدًا (الحد 150 حرف)';
      else result.institutionName = name;
    }
  } else {
    if (typeof rawOccupation !== 'string' || !rawOccupation.trim()) {
      result.errors.occupation = 'اكتب وظيفة العميل';
    } else {
      const occupation = rawOccupation.trim().replace(/\s+/g, ' ');
      if (occupation.length > 100) result.errors.occupation = 'الوظيفة طويلة جدًا (الحد 100 حرف)';
      else result.occupation = occupation;
    }
  }
  return result;
}

export function formatCustomerProfileDisplay(
  category: string | null | undefined,
  level: string | null | undefined,
  institution: string | null | undefined,
  occupation: string | null | undefined,
): string {
  if (category === 'student') {
    return ['طالب', level === 'school' ? 'مدرسة' : level === 'college' ? 'كلية' : '', institution]
      .filter(Boolean).join(' — ');
  }
  if (category === 'adult') return ['بالغ', occupation].filter(Boolean).join(' — ');
  return '';
}
