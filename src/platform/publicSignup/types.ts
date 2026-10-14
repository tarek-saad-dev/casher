export const PUBLIC_SIGNUP_INDUSTRIES = ['salon', 'clinic', 'supermarket'] as const;
export type PublicSignupIndustry = (typeof PUBLIC_SIGNUP_INDUSTRIES)[number];

export const PUBLIC_SIGNUP_NEEDS = [
  'booking',
  'pos',
  'workforce',
  'payroll',
  'treasury',
  'reports',
  'inventory',
] as const;
export type PublicSignupNeed = (typeof PUBLIC_SIGNUP_NEEDS)[number];

export type PublicSignupStartMode = 'real' | 'demo';

export type PublicSignupInput = {
  industry: PublicSignupIndustry;
  needs: PublicSignupNeed[];
  contactName: string;
  businessName: string;
  phone: string;
  email?: string | null;
  password: string;
  startMode: PublicSignupStartMode;
};

export type PublicSignupResult = {
  signupId: string;
  tenantId: string;
  tenantCode: string;
  ownerLoginName: string;
  branchCode: string;
  trialEndsAt: string | null;
  nextPath: string;
};
