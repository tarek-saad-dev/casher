import { describe, it, expect } from 'vitest';
import {
  TBL_CLIENT_MOBILE_STRIPPED_SQL,
  TBL_CLIENT_MOBILE_SUFFIX_SQL,
  getClientMobileLookupSuffix,
} from '@/lib/client/publicClientWebsite.helpers';

describe('TBL_CLIENT_MOBILE_SUFFIX_SQL', () => {
  it('wraps normalized mobile in RIGHT(expr, 10)', () => {
    expect(TBL_CLIENT_MOBILE_SUFFIX_SQL).toMatch(
      /RIGHT\s*\(\s*REPLACE\s*\([\s\S]+,\s*N'\+'\s*,\s*N''\s*\)\s*,\s*10\s*\)/,
    );
  });

  it('uses only three-argument REPLACE templates (no dangling args)', () => {
    const dangling = TBL_CLIENT_MOBILE_SUFFIX_SQL.match(/,\s*10\s*\)\s*,/);
    expect(dangling).toBeNull();
    expect(TBL_CLIENT_MOBILE_SUFFIX_SQL).not.toMatch(/REPLACE\s*\([^)]*,\s*10\s*\)/);
  });

  it('strips common phone formatting before suffix extraction', () => {
    expect(TBL_CLIENT_MOBILE_STRIPPED_SQL).toContain("N' '");
    expect(TBL_CLIENT_MOBILE_STRIPPED_SQL).toContain("N'-'");
    expect(TBL_CLIENT_MOBILE_STRIPPED_SQL).toContain("N'('");
    expect(TBL_CLIENT_MOBILE_STRIPPED_SQL).toContain("N')'");
  });
});

describe('getClientMobileLookupSuffix parity inputs', () => {
  const cases = [
    '01012345678',
    '+20 101 234 5678',
    '00201012345678',
    '201012345678',
    '010-1234-5678',
    '(010) 1234-5678',
  ];

  it.each(cases)('produces a 10-digit suffix for %s', (phone) => {
    const suffix = getClientMobileLookupSuffix(phone);
    expect(suffix).toMatch(/^\d{10}$/);
  });

  it('maps Egyptian variants to the same suffix', () => {
    const expected = getClientMobileLookupSuffix('01012345678');
    expect(getClientMobileLookupSuffix('+20 101 234 5678')).toBe(expected);
    expect(getClientMobileLookupSuffix('00201012345678')).toBe(expected);
    expect(getClientMobileLookupSuffix('201012345678')).toBe(expected);
  });
});
