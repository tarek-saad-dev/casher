import { describe, expect, it } from 'vitest';
import {
  APPROVED_TEST_DATABASES,
  PRODUCTION_DATABASE,
  STAGING_DATABASE,
  UnapprovedTestDatabaseError,
  assertApprovedTestDatabase,
  isAllowlistedTestDatabaseName,
  isProductionDatabaseName,
  resolveConfiguredDatabaseName,
} from '@/lib/db/assertApprovedTestDatabase';

function fakePool(databaseName: string, loginName = 'drvo_agent') {
  return {
    request() {
      return {
        async query() {
          return {
            recordset: [{ DatabaseName: databaseName, LoginName: loginName }],
          };
        },
      };
    },
  };
}

describe('assertApprovedTestDatabase', () => {
  it('hard-denies production last132 even with approval flag', async () => {
    await expect(
      assertApprovedTestDatabase(fakePool(PRODUCTION_DATABASE), {
        APPROVED_TEST_DB: '1',
        DB_DATABASE: PRODUCTION_DATABASE,
      }),
    ).rejects.toBeInstanceOf(UnapprovedTestDatabaseError);
  });

  it('denies when approval flag is missing', async () => {
    await expect(
      assertApprovedTestDatabase(fakePool(STAGING_DATABASE), {
        DB_DATABASE: STAGING_DATABASE,
      }),
    ).rejects.toThrow(/APPROVED_TEST_DB/);
  });

  it('accepts staging last132_agent with explicit approval', async () => {
    const result = await assertApprovedTestDatabase(fakePool(STAGING_DATABASE, 'drvo_agent'), {
      APPROVED_TEST_DB: '1',
      DB_DATABASE: STAGING_DATABASE,
      LOCAL_DB_NAME: STAGING_DATABASE,
    });
    expect(result.ok).toBe(true);
    expect(result.approvedName).toBe(STAGING_DATABASE);
    expect(result.identity.loginName).toBe('drvo_agent');
  });

  it('rejects env/live mismatch', async () => {
    await expect(
      assertApprovedTestDatabase(fakePool(STAGING_DATABASE), {
        APPROVED_TEST_DB: 'true',
        DB_DATABASE: 'some_other_test_db',
      }),
    ).rejects.toThrow(/does not match/);
  });

  it('rejects unknown non-allowlisted databases', async () => {
    await expect(
      assertApprovedTestDatabase(fakePool('customer_prod_copy'), {
        APPROVED_TEST_DB: '1',
        DB_DATABASE: 'customer_prod_copy',
      }),
    ).rejects.toBeInstanceOf(UnapprovedTestDatabaseError);
  });

  it('allowlists approved names and naming conventions', () => {
    expect(isProductionDatabaseName('last132')).toBe(true);
    expect(isProductionDatabaseName('last132_agent')).toBe(false);
    expect(isAllowlistedTestDatabaseName(STAGING_DATABASE)).toBe(true);
    expect(isAllowlistedTestDatabaseName('hawai_booking_v2_isolated')).toBe(true);
    expect(isAllowlistedTestDatabaseName('last132')).toBe(false);
    expect(APPROVED_TEST_DATABASES).toContain(STAGING_DATABASE);
  });

  it('resolves configured name with LOCAL_DB_NAME precedence', () => {
    expect(
      resolveConfiguredDatabaseName({
        LOCAL_DB_NAME: 'last132_agent',
        DB_DATABASE: 'last132',
        DB_NAME: 'last132',
      }),
    ).toBe('last132_agent');
  });
});
