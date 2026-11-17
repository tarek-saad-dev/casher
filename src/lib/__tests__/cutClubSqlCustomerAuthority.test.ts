import { describe, expect, it } from "vitest";
import type sql from "mssql";
import { bindVerifiedCustomer } from "@/lib/cut-club/otpDomain";
import {
  createSqlCutClubCustomerAuthority, normalizeCutClubEgyptianPhone,
} from "@/lib/cut-club/sqlCustomerAuthority";

const tenant = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const foreign = "e1413a3e-dc87-4a70-bc6e-d00d76f9066b";

function fakePool(rows: readonly unknown[]) {
  const bound: Record<string, unknown> = {};
  let sqlText = "";
  const pool = {
    request: () => ({
      input(name: string, _type: unknown, value: unknown) {
        bound[name] = value;
        return this;
      },
      async query(query: string) {
        sqlText = query;
        return { recordset: rows };
      },
    }),
  } as unknown as sql.ConnectionPool;
  return { pool, bound, query: () => sqlText };
}

describe("CUT CLUB SQL tenant customer authority — synthetic, read-only", () => {
  it("normalizes accepted Egypt phones to exact E164, rejects malformed/foreign", () => {
    for (const phone of ["01012345678", "+201012345678", "201012345678", "(010) 1234-5678"]) {
      expect(normalizeCutClubEgyptianPhone(phone)).toBe("+201012345678");
    }
    for (const phone of ["123456", "0101234567", "+971501234567", "+2010123456789", "011 1234 567x", null, {}]) {
      expect(normalizeCutClubEgyptianPhone(phone)).toBeNull();
    }
  });

  it("validates actual tenant/customer ownership using parameterized SQL only", async () => {
    const fake = fakePool([{ ClientID: 42 }]);
    const authority = createSqlCutClubCustomerAuthority(fake.pool);
    expect(await authority.proveOwnedCustomer({ tenantId: tenant, customerId: 42 })).toBe(true);
    expect(fake.bound).toMatchObject({ tenantId: tenant, clientId: 42 });
    expect(fake.query()).toContain("c.TenantId=@tenantId AND c.ClientID=@clientId");
    expect(fake.query()).toContain("TOP (2)");
    expect(fake.query()).not.toContain("UPDATE ");
  });

  it("fails without a matching client, or for bad UUID/ID", async () => {
    const fake = fakePool([]);
    const authority = createSqlCutClubCustomerAuthority(fake.pool);
    expect(await authority.proveOwnedCustomer({ tenantId: tenant, customerId: 42 })).toBe(false);
    expect(await authority.proveOwnedCustomer({ tenantId: "fake", customerId: 42 })).toBe(false);
    expect(await authority.proveOwnedCustomer({ tenantId: tenant, customerId: 0 })).toBe(false);
  });

  it("resolves one active tenant-owned customer after verified WhatsApp code only", async () => {
    const fake = fakePool([{ ClientID: 42, TenantId: tenant, Active: true }]);
    const authority = createSqlCutClubCustomerAuthority(fake.pool);
    const matches = await authority.resolveByVerifiedWhatsAppPhone({
      trustedTenantId: tenant, verifiedPhoneE164: "+201012345678",
    });
    expect(matches).toEqual([{ customerId: 42, tenantId: tenant, active: true }]);
    expect(fake.bound).toMatchObject({
      tenantId: tenant, e164: "+201012345678",
      local: "01012345678", digits: "201012345678",
    });
    expect(fake.query()).toContain("SELECT DISTINCT TOP (3)");
    expect(fake.query()).toContain("c.TenantId=@tenantId");
    expect(fake.query()).toContain("c.Mobile IN (@local,@e164,@digits)");
    expect(fake.query()).toContain("cl.IsActive=1");
    expect(bindVerifiedCustomer(matches, tenant)).toEqual({
      ok: true, customerId: 42, tenantId: tenant,
    });
  });

  it("rejects duplicate/shared phones and inactive customers without issuing session", async () => {
    const dupe = createSqlCutClubCustomerAuthority(fakePool([
      { ClientID: 42, TenantId: tenant, Active: true },
      { ClientID: 43, TenantId: tenant, Active: true },
    ]).pool);
    const matches = await dupe.resolveByVerifiedWhatsAppPhone({
      trustedTenantId: tenant, verifiedPhoneE164: "+201012345678",
    });
    expect(matches).toHaveLength(2);
    expect(bindVerifiedCustomer(matches, tenant).ok).toBe(false);

    const inactive = createSqlCutClubCustomerAuthority(fakePool([
      { ClientID: 42, TenantId: tenant, Active: false },
    ]).pool);
    const nonMember = await inactive.resolveByVerifiedWhatsAppPhone({
      trustedTenantId: tenant, verifiedPhoneE164: "+201012345678",
    });
    expect(nonMember).toEqual([{ customerId: 42, tenantId: tenant, active: false }]);
    expect(bindVerifiedCustomer(nonMember, tenant).ok).toBe(false);
  });

  it("fails closed on a foreign row or unverified phone despite SQL protection", async () => {
    const mixed = createSqlCutClubCustomerAuthority(fakePool([
      { ClientID: 42, TenantId: tenant, Active: true },
      { ClientID: 90, TenantId: foreign, Active: true },
    ]).pool);
    expect(await mixed.resolveByVerifiedWhatsAppPhone({
      trustedTenantId: tenant, verifiedPhoneE164: "+201012345678",
    })).toEqual([]);
    expect(await mixed.resolveByVerifiedWhatsAppPhone({
      trustedTenantId: tenant, verifiedPhoneE164: "01012345678",
    })).toEqual([]);
    expect(await mixed.resolveByVerifiedWhatsAppPhone({
      trustedTenantId: foreign, verifiedPhoneE164: "+971501234567",
    })).toEqual([]);
  });

  it("does not disclose name, phone, Coins or voucher codes", async () => {
    const authority = createSqlCutClubCustomerAuthority(fakePool([
      { ClientID: 42, TenantId: tenant, Active: 1, Mobile: "01012345678", Name: "Hidden" },
    ]).pool);
    const matches = await authority.resolveByVerifiedWhatsAppPhone({
      trustedTenantId: tenant, verifiedPhoneE164: "+201012345678",
    });
    expect(matches).toEqual([{ customerId: 42, tenantId: tenant, active: true }]);
    expect(JSON.stringify(matches)).not.toContain("01012345678");
    expect(JSON.stringify(matches)).not.toContain("Hidden");
  });
});
