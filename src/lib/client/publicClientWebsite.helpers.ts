import { normalizePublicBookingPhone } from '@/lib/publicBookingHelpers';

/** SQL expression — last 10 digits of normalized TblClient.Mobile (matches lookup suffix logic). */
export const TBL_CLIENT_MOBILE_SUFFIX_SQL = `
  RIGHT(
    REPLACE(REPLACE(REPLACE(REPLACE(
      CASE
        WHEN REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N'') LIKE N'0020%'
          THEN N'0' + SUBSTRING(REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N''), 5, 8000)
        WHEN REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N'') LIKE N'+20%'
          THEN N'0' + SUBSTRING(REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N''), 4, 8000)
        WHEN REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N'') LIKE N'20%'
          AND LEN(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N''), N'(', N''), N')', N'')) > 10
          THEN N'0' + SUBSTRING(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), 3, 8000)
        ELSE REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(Mobile, N''), N' ', N''), N'-', N''), N'(', N''), N')', N'')
      END,
      N'+', N''),
      N' ', N''),
      N')', N''),
    10
  )
`;

export function normalizeClientWebsiteMobileInput(mobile: string): string {
  return normalizePublicBookingPhone(mobile.trim());
}

/** Last 10 digits used for TblClient.Mobile identity matching. */
export function getClientMobileLookupSuffix(mobile: string): string | null {
  const normalized = normalizeClientWebsiteMobileInput(mobile);
  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sanitizeOptionalString(
  value: unknown,
  maxLen: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export function validateClientWebsiteEmail(email: string | null | undefined): string | null {
  if (email === undefined) return null;
  if (email === null) return null;
  if (!EMAIL_RE.test(email)) return 'Invalid email';
  return null;
}

export type PublicClientWebsiteProfile = {
  id: number;
  name: string | null;
  mobile: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
};

export type PublicClientWebsiteUpdateInput = {
  clientId: number;
  name?: string;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  email?: string | null;
};

const EDITABLE_FIELDS = ['name', 'phone', 'mobile', 'address', 'email'] as const;

export function pickEditableClientUpdateFields(body: Record<string, unknown>): {
  fields: Partial<Omit<PublicClientWebsiteUpdateInput, 'clientId'>>;
  hasEditableField: boolean;
} {
  const fields: Partial<Omit<PublicClientWebsiteUpdateInput, 'clientId'>> = {};
  let hasEditableField = false;

  for (const key of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      hasEditableField = true;
      if (key === 'name') {
        if (typeof body.name === 'string') fields.name = body.name.trim();
      } else {
        fields[key] = sanitizeOptionalString(body[key], key === 'address' ? 200 : 30) ?? null;
      }
    }
  }

  return { fields, hasEditableField };
}
