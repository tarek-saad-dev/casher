import { describe, expect, it } from 'vitest';
import { validateCustomerProfile, formatCustomerProfileDisplay, isCustomerProfileIncomplete } from '@/lib/customerProfile';
import { isCustomerIncomplete } from '@/lib/customerSource';
import type { Customer } from '@/lib/types';

describe('customer demographics', () => {
  it('preserves unknown legacy clients with an empty optional category', () => {
    expect(validateCustomerProfile(undefined, undefined, undefined, undefined)).toMatchObject({
      customerCategory: null, educationLevel: null, institutionName: null, occupation: null, errors: {},
    });
  });
  it('requires education stage and institution for students', () => {
    const invalid = validateCustomerProfile('student', '', '', 'doctor');
    expect(invalid.errors.educationLevel).toBeTruthy();
    expect(invalid.errors.institutionName).toBeTruthy();
    expect(invalid.occupation).toBeNull();
  });
  it('normalizes student and clears adult occupation', () => {
    expect(validateCustomerProfile('student', 'college', '  جامعة   الإسكندرية ', 'doctor')).toMatchObject({
      customerCategory: 'student', educationLevel: 'college',
      institutionName: 'جامعة الإسكندرية', occupation: null, errors: {},
    });
  });
  it('normalizes adult occupation and clears student details', () => {
    expect(validateCustomerProfile('adult', 'school', 'مدرسة', '  مهندس   مدني  ')).toMatchObject({
      customerCategory: 'adult', educationLevel: null, institutionName: null, occupation: 'مهندس مدني', errors: {},
    });
  });
  it('rejects missing job and invalid category', () => {
    expect(validateCustomerProfile('adult', '', '', ' ').errors.occupation).toBeTruthy();
    expect(validateCustomerProfile('other', '', '', '').errors.customerCategory).toBeTruthy();
  });
  it('rejects names longer than DB limits', () => {
    expect(validateCustomerProfile('student', 'school', 'x'.repeat(151), '').errors.institutionName).toBeTruthy();
    expect(validateCustomerProfile('adult', '', '', 'x'.repeat(101)).errors.occupation).toBeTruthy();
  });
  it('formats existing customer demographics', () => {
    expect(formatCustomerProfileDisplay('student', 'school', 'سان مارك', null)).toContain('سان مارك');
    expect(formatCustomerProfileDisplay('adult', null, null, 'طبيب')).toBe('بالغ — طبيب');
  });
  it('marks legacy customers and unfinished student/adult answers as incomplete', () => {
    expect(isCustomerProfileIncomplete({ CustomerCategory: null })).toBe(true);
    expect(isCustomerProfileIncomplete({ CustomerCategory: 'student', EducationLevel: null, InstitutionName: '' })).toBe(true);
    expect(isCustomerProfileIncomplete({ CustomerCategory: 'student', EducationLevel: 'school', InstitutionName: '  ' })).toBe(true);
    expect(isCustomerProfileIncomplete({ CustomerCategory: 'student', EducationLevel: 'college', InstitutionName: 'كلية الهندسة' })).toBe(false);
    expect(isCustomerProfileIncomplete({ CustomerCategory: 'adult', Occupation: '' })).toBe(true);
    expect(isCustomerProfileIncomplete({ CustomerCategory: 'adult', Occupation: 'طبيب' })).toBe(false);
  });
  it('flags POS customers for completion even when other personal data is already filled', () => {
    const customer = {
      BirthDate: '2000-01-01', Address: 'Alexandria', CameFrom: 'walk_by',
      CustomerCategory: null,
    } as Customer;
    expect(isCustomerIncomplete(customer)).toBe(true);
    expect(isCustomerIncomplete({ ...customer, CustomerCategory: 'adult', Occupation: 'مدرس' })).toBe(false);
    expect(isCustomerIncomplete({ ...customer, CustomerCategory: 'student', EducationLevel: 'school', InstitutionName: '' })).toBe(true);
  });
});
