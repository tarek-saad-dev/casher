import { describe, expect, it } from 'vitest';
import { validateCustomerProfile, formatCustomerProfileDisplay } from '@/lib/customerProfile';

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
});
