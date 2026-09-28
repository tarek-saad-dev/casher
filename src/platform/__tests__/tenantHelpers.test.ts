import { describe, expect, it } from 'vitest';
import { tenantLockResource, tenantCacheKey } from '@/platform/public';

describe('tenant namespace helpers', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';

  it('builds applock resources per DRVO-002 recipe', () => {
    expect(tenantLockResource(tenantId, ['emp', '5', '1000', '2000'])).toBe(
      't:11111111-1111-1111-1111-111111111111:emp:5:1000:2000',
    );
  });

  it('builds cache keys per DRVO-002 recipe', () => {
    expect(tenantCacheKey(tenantId, 'booking', ['hold', 'abc'])).toBe(
      't:11111111-1111-1111-1111-111111111111:booking:hold:abc',
    );
  });
});
