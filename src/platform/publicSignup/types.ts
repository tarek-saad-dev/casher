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

export type PublicSignupIndustry = string;
export type PublicSignupStartMode = 'real' | 'demo';

export type PublicIndustryOption = {
  code: string;
  titleAr: string;
  descriptionAr: string;
  iconKey: string;
  defaultNeeds: string[];
  supportsDemo: boolean;
  catalogKind: 'services' | 'products';
  terminology: {
    branch: string;
    customer: string;
    catalogItem: string;
    teamMember: string;
    provider: string;
  };
};

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
