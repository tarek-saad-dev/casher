import { describe, expect, it } from 'vitest';
import { localSignupPhone, SIGNUP_STEPS, signupStepError, type SignupDraft } from '@/platform/publicSignup/presentation';

const draft: SignupDraft = { industry: 'salon', selectedApps: ['pos'], contactName: 'محمد أحمد', businessName: 'صالون', phone: '01012345678', email: '', password: 'secure-password', confirmation: 'secure-password', startMode: 'real' };

describe('signup V2 presentation', () => {
  it('normalizes mobile entry without pretending to verify ownership', () => {
    for (const value of ['01012345678', '+20 1012345678', '00201012345678', '٠١٠١٢٣٤٥٦٧٨', '۰۱۰۱۲۳۴۵۶۷۸']) expect(localSignupPhone(value)).toBe('01012345678');
    for (const value of ['abc01012345678', '1234', '', '010123456789']) expect(localSignupPhone(value)).toBeNull();
  });
  it('requires all five steps to be valid before submission', () => {
    expect(SIGNUP_STEPS).toHaveLength(5);
    for (let step = 0; step < 5; step++) expect(signupStepError(step, draft, null)).toBeNull();
    expect(signupStepError(4, { ...draft, industry: null }, null)).not.toBeNull();
    expect(signupStepError(4, draft, 'invalid apps')).toBe('invalid apps');
    expect(signupStepError(4, { ...draft, email: 'bad' }, null)).not.toBeNull();
    expect(signupStepError(4, { ...draft, confirmation: 'wrong' }, null)).not.toBeNull();
  });
  it('rejects whitespace-bound passwords that would fail subsequent login and invalid lengths', () => {
    for (const password of ['short', ' leading-space', 'trailing-space ', 'x'.repeat(129)]) {
      expect(signupStepError(3, { ...draft, password, confirmation: password }, null)).not.toBeNull();
    }
  });
});
